import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";

const rulesPath = process.env.RULES_PATH || "../firestore.rules";
const env = await initializeTestEnvironment({ projectId: "demo-handout", firestore: { rules: readFileSync(rulesPath, "utf8"), host: "127.0.0.1", port: 8091 } });
const R = "rooms/R1";
const seed = async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, `${R}/meta/gm`), { gmUid: "gm1", gmCcfoliaUid: "acct-gm", gmCharacter: "GM" });
    await setDoc(doc(db, `${R}/handouts/h1`), { id: "h1", title: "t", description: "공개", gmNotes: "비밀" });
    await setDoc(doc(db, `${R}/inbox/p1/handouts/h1`), { id: "h1", title: "t" });
    await setDoc(doc(db, `${R}/members/p1`), { ccfoliaUid: "acct-1", displayName: "앨리스" });
    await setDoc(doc(db, `${R}/images/i1`), { chunkCount: 1 });
    await setDoc(doc(db, `${R}/images/i1/chunks/0000`), { index: 0, data: "x" });
    await setDoc(doc(db, `${R}/images/i3`), { chunkCount: 1, ownerUid: "p1" });
    await setDoc(doc(db, `${R}/images/i3/chunks/0000`), { index: 0, data: "mine" });
  });
};
const as = uid => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());
let failures = 0;
const check = async (name, promise, expectOk) => {
  try { await (expectOk ? assertSucceeds(promise) : assertFails(promise)); console.log("ok  ", name); }
  catch (error) { failures += 1; console.log("FAIL", name, "-", String(error.message).split("\n")[0].slice(0, 140)); }
};
await seed();
// originals: GM only
await check("GM reads the original", getDoc(doc(as("gm1"), `${R}/handouts/h1`)), true);
await check("a player cannot read the original", getDoc(doc(as("p1"), `${R}/handouts/h1`)), false);
await check("not signed in cannot read the original", getDoc(doc(as(null), `${R}/handouts/h1`)), false);
await check("GM writes an original", setDoc(doc(as("gm1"), `${R}/handouts/h2`), { id: "h2" }), true);
await check("a player cannot overwrite an original", setDoc(doc(as("p1"), `${R}/handouts/h1`), { id: "h1", ownerUid: "p1" }), false);
await check("a player cannot create a handout", setDoc(doc(as("p1"), `${R}/handouts/h9`), { id: "h9" }), false);
await check("a player cannot delete an original", deleteDoc(doc(as("p1"), `${R}/handouts/h1`)), false);
// inbox
await check("a player reads their own inbox copy", getDoc(doc(as("p1"), `${R}/inbox/p1/handouts/h1`)), true);
await check("a player cannot read another person's inbox copy", getDoc(doc(as("p2"), `${R}/inbox/p1/handouts/h1`)), false);
await check("a player cannot list another person's inbox", getDocs(collection(as("p2"), `${R}/inbox/p1/handouts`)), false);
await check("a player lists their own inbox", getDocs(collection(as("p1"), `${R}/inbox/p1/handouts`)), true);
await check("GM writes an inbox copy", setDoc(doc(as("gm1"), `${R}/inbox/p2/handouts/h1`), { id: "h1" }), true);
await check("GM deletes an inbox copy", deleteDoc(doc(as("gm1"), `${R}/inbox/p2/handouts/h1`)), true);
await check("a player cannot write their own inbox copy", setDoc(doc(as("p1"), `${R}/inbox/p1/handouts/h5`), { id: "h5", gmNotes: "x" }), false);
// members
await check("a player registers their own account", setDoc(doc(as("p2"), `${R}/members/p2`), { ccfoliaUid: "acct-2", displayName: "밥", updatedAt: new Date() }), true);
await check("a player cannot register for somebody else", setDoc(doc(as("p2"), `${R}/members/p3`), { ccfoliaUid: "acct-2", displayName: "밥" }), false);
await check("members: extra fields are refused", setDoc(doc(as("p2"), `${R}/members/p2`), { ccfoliaUid: "acct-2", displayName: "밥", role: "gm" }), false);
await check("members: empty account uid is refused", setDoc(doc(as("p2"), `${R}/members/p2`), { ccfoliaUid: "", displayName: "밥" }), false);
await check("members: a long name is refused", setDoc(doc(as("p2"), `${R}/members/p2`), { ccfoliaUid: "a", displayName: "x".repeat(100) }), false);
await check("GM reads any member record", getDoc(doc(as("gm1"), `${R}/members/p1`)), true);
await check("a player reads their own member record", getDoc(doc(as("p1"), `${R}/members/p1`)), true);
await check("a player cannot read another member record", getDoc(doc(as("p2"), `${R}/members/p1`)), false);
// GM seat
await check("anybody cannot take the seat by overwriting meta/gm", setDoc(doc(as("evil"), `${R}/meta/gm`), { gmUid: "evil", gmCcfoliaUid: "" }), false);
await check("a claim with the wrong account uid is refused", updateDoc(doc(as("evil"), `${R}/meta/gm`), { gmUid: "evil", gmCcfoliaUid: "acct-other" }), false);
await check("a claim without any account uid is refused", updateDoc(doc(as("evil"), `${R}/meta/gm`), { gmUid: "evil" }), false);
await check("the GM updates the seat", updateDoc(doc(as("gm1"), `${R}/meta/gm`), { gmCharacter: "새 GM" }), true);
await check("a merge update that leaves the account uid alone cannot take the seat", updateDoc(doc(as("evil"), `${R}/meta/gm`), { gmUid: "evil", gmCcfoliaUid: "acct-gm" }), false);
await check("a full write with the right account uid but no proof document is refused", setDoc(doc(as("gm2"), `${R}/meta/gm`), { gmUid: "gm2", gmCcfoliaUid: "acct-gm" }), false);
await check("a proof document for a wrong account uid is refused", setDoc(doc(as("gm2"), `${R}/claims/acct-other_gm2`), { at: 1 }), false);
await check("a proof document in the name of somebody else's uid is refused", setDoc(doc(as("gm2"), `${R}/claims/acct-gm_gm3`), { at: 1 }), false);
await check("the same account on a new browser: proof document", setDoc(doc(as("gm2"), `${R}/claims/acct-gm_gm2`), { at: 1 }), true);
await check("the same account on a new browser takes the seat back", setDoc(doc(as("gm2"), `${R}/meta/gm`), { gmUid: "gm2", gmCcfoliaUid: "acct-gm", gmCharacter: "GM" }), true);
await check("the old browser (no proof for its uid now) cannot take it from the new one", setDoc(doc(as("gm1"), `${R}/meta/gm`), { gmUid: "gm1", gmCcfoliaUid: "acct-gm" }), false);
await check("a proof document cannot be read", getDoc(doc(as("gm2"), `${R}/claims/acct-gm_gm2`)), false);
await seed();
await check("the first writer creates the seat in a new room", setDoc(doc(as("gm9"), "rooms/R9/meta/gm"), { gmUid: "gm9", gmCcfoliaUid: "a" }), true);
await check("creating the seat for somebody else is refused", setDoc(doc(as("evil"), "rooms/R8/meta/gm"), { gmUid: "gm8" }), false);
// folders
await check("everybody signed in reads the folders", getDoc(doc(as("p1"), `${R}/meta/folders`)), true);
await check("GM writes the folders", setDoc(doc(as("gm1"), `${R}/meta/folders`), { folders: [] }), true);
await check("a player cannot write the folders", setDoc(doc(as("p1"), `${R}/meta/folders`), { folders: [] }), false);
// shows
await check("GM creates a show signal", setDoc(doc(as("gm1"), `${R}/shows/s1`), { handoutId: "h1", atUid: "gm1" }), true);
await check("a player cannot create a show signal", setDoc(doc(as("p1"), `${R}/shows/s2`), { handoutId: "h1", atUid: "p1" }), false);
await check("a player reads a show signal", getDoc(doc(as("p1"), `${R}/shows/s1`)), true);
// presence
await check("presence: own record", setDoc(doc(as("p1"), `${R}/presence/p1`), { at: 1 }), true);
await check("presence: somebody else's record is refused", setDoc(doc(as("p1"), `${R}/presence/p2`), { at: 1 }), false);
// images
await check("a player gets a picture by id", getDoc(doc(as("p1"), `${R}/images/i1`)), true);
await check("a player cannot list the pictures", getDocs(collection(as("p1"), `${R}/images`)), false);
await check("a player reads the chunks of a picture", getDocs(collection(as("p1"), `${R}/images/i1/chunks`)), true);
await check("a player cannot delete a picture", deleteDoc(doc(as("p1"), `${R}/images/i1`)), false);
await check("a player cannot overwrite a chunk", setDoc(doc(as("p1"), `${R}/images/i1/chunks/0000`), { data: "evil" }), false);
await check("GM uploads a picture", setDoc(doc(as("gm1"), `${R}/images/i2`), { chunkCount: 1 }), true);
await check("GM deletes a picture", deleteDoc(doc(as("gm1"), `${R}/images/i1`)), true);
// pictures pasted into the chat (format tool): the writer owns them through ownerUid
await check("a player creates a picture of their own", setDoc(doc(as("p2"), `${R}/images/n1`), { chunkCount: 1, ownerUid: "p2", status: "uploading" }), true);
await check("...and its chunk", setDoc(doc(as("p2"), `${R}/images/n1/chunks/0000`), { index: 0, data: "y" }), true);
await check("...and marks it ready (merge update)", setDoc(doc(as("p2"), `${R}/images/n1`), { status: "ready" }, { merge: true }), true);
await check("a picture in somebody else's name is refused", setDoc(doc(as("p2"), `${R}/images/n2`), { chunkCount: 1, ownerUid: "p1" }), false);
await check("a picture without an owner is refused for a player", setDoc(doc(as("p2"), `${R}/images/n3`), { chunkCount: 1 }), false);
await check("a chunk of a picture that does not exist is refused", setDoc(doc(as("p2"), `${R}/images/nope/chunks/0000`), { index: 0, data: "z" }), false);
await check("another player cannot change the picture", setDoc(doc(as("p3"), `${R}/images/n1`), { status: "ready" }, { merge: true }), false);
await check("another player cannot change its chunk", setDoc(doc(as("p3"), `${R}/images/n1/chunks/0000`), { index: 0, data: "evil" }), false);
await check("another player cannot delete it", deleteDoc(doc(as("p3"), `${R}/images/n1`)), false);
await check("another player cannot add a chunk to it", setDoc(doc(as("p3"), `${R}/images/n1/chunks/0001`), { index: 1, data: "evil" }), false);
await check("the owner cannot hand the picture to somebody else", setDoc(doc(as("p2"), `${R}/images/n1`), { ownerUid: "p3" }, { merge: true }), false);
await check("an existing picture cannot be taken over by creating it again", setDoc(doc(as("p2"), `${R}/images/i3`), { chunkCount: 1, ownerUid: "p2" }), false);
await check("a player lists their own picture's chunks", getDocs(collection(as("p2"), `${R}/images/n1/chunks`)), true);
await check("the owner deletes the chunk and the picture", (async () => { await deleteDoc(doc(as("p1"), `${R}/images/i3/chunks/0000`)); await deleteDoc(doc(as("p1"), `${R}/images/i3`)); })(), true);
await check("GM deletes a player's picture", deleteDoc(doc(as("gm1"), `${R}/images/n1`)), true);
await check("GM writes a handout picture with no owner field", setDoc(doc(as("gm1"), `${R}/images/h-img`), { chunkCount: 1, status: "uploading" }), true);
await check("GM writes its chunk", setDoc(doc(as("gm1"), `${R}/images/h-img/chunks/0000`), { index: 0, data: "g" }), true);
await check("GM marks it ready", setDoc(doc(as("gm1"), `${R}/images/h-img`), { status: "ready" }, { merge: true }), true);
await check("a player cannot change the GM's picture", setDoc(doc(as("p2"), `${R}/images/h-img`), { status: "x" }, { merge: true }), false);
await check("not signed in cannot create a picture", setDoc(doc(as(null), `${R}/images/n9`), { ownerUid: "" }), false);
await check("not signed in cannot get a picture", getDoc(doc(as(null), `${R}/images/i2`)), false);
await check("an unknown path is closed", getDoc(doc(as("gm1"), `${R}/secrets/x`)), false);
// character sheets (room shared storage): public part in sheets, secret/mission in sheetSecrets that follows the sheet's ownerUid
const sh = (uid, extra = {}) => ({ json: "{}", ownerUid: uid, updatedAt: 1, ...extra });
await check("a member creates a sheet with their own ownerUid", setDoc(doc(as("p1"), `${R}/sheets/s1`), sh("p1")), true);
await check("a non-member cannot create a sheet", setDoc(doc(as("p9"), `${R}/sheets/s2`), sh("p9")), false);
await check("a member cannot write a sheet in somebody else's name", setDoc(doc(as("p1"), `${R}/sheets/s3`), sh("p7")), false);
await check("sheets: extra fields are refused", setDoc(doc(as("p1"), `${R}/sheets/s4`), sh("p1", { gmNotes: "x" })), false);
await check("sheets: json must be a string", setDoc(doc(as("p1"), `${R}/sheets/s5`), sh("p1", { json: { a: 1 } })), false);
await check("anybody signed in reads a sheet", getDoc(doc(as("p9"), `${R}/sheets/s1`)), true);
await check("not signed in cannot read a sheet", getDoc(doc(as(null), `${R}/sheets/s1`)), false);
await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${R}/members/p2`), { ccfoliaUid: "acct-2", displayName: "밥" }); });
await check("a member takes over a sheet by reporting their own ownerUid", setDoc(doc(as("p2"), `${R}/sheets/s1`), sh("p2", { updatedAt: 2 })), true);
await check("the GM writes any sheet", setDoc(doc(as("gm1"), `${R}/sheets/s1`), sh("gm1", { updatedAt: 3 })), true);
await check("the GM can put a sheet back to a player", setDoc(doc(as("gm1"), `${R}/sheets/s1`), sh("p1", { updatedAt: 4 })), true);
await check("a stranger cannot delete a sheet", deleteDoc(doc(as("p2"), `${R}/sheets/s1`)), false);
await check("the owner deletes a sheet", deleteDoc(doc(as("p1"), `${R}/sheets/s1`)), true);
// secrets follow the owner
await setDoc(doc(as("p1"), `${R}/sheets/s6`), sh("p1"));
await check("the owner writes the secret part", setDoc(doc(as("p1"), `${R}/sheetSecrets/s6`), { json: '{"secret":"x"}', updatedAt: 1 }), true);
await check("the owner reads the secret part", getDoc(doc(as("p1"), `${R}/sheetSecrets/s6`)), true);
await check("the GM reads the secret part", getDoc(doc(as("gm1"), `${R}/sheetSecrets/s6`)), true);
await check("another player cannot read the secret part", getDoc(doc(as("p2"), `${R}/sheetSecrets/s6`)), false);
await check("another player cannot list the secrets", getDocs(collection(as("p2"), `${R}/sheetSecrets`)), false);
await check("another player cannot write the secret part", setDoc(doc(as("p2"), `${R}/sheetSecrets/s6`), { json: "{}", updatedAt: 2 }), false);
await check("secrets: extra fields are refused", setDoc(doc(as("p1"), `${R}/sheetSecrets/s6`), { json: "{}", updatedAt: 2, ownerUid: "p1" }), false);
const db2 = as("p2"); const claim = writeBatch(db2); claim.set(doc(db2, `${R}/sheets/s6`), sh("p2", { updatedAt: 5 })); claim.set(doc(db2, `${R}/sheetSecrets/s6`), { json: '{"secret":"y"}', updatedAt: 5 });
await check("a takeover (one batch: sheet with the new ownerUid + secrets) is accepted", claim.commit(), true);
await check("the new owner now reads the secret part", getDoc(doc(as("p2"), `${R}/sheetSecrets/s6`)), true);
await check("the old owner no longer reads the secret part", getDoc(doc(as("p1"), `${R}/sheetSecrets/s6`)), false);
await check("a secret part for a sheet that does not exist is refused", setDoc(doc(as("p1"), `${R}/sheetSecrets/nope`), { json: "{}", updatedAt: 1 }), false);
await env.cleanup();
console.log(failures ? `${failures} FAILED` : "all rules checks passed");
process.exit(failures ? 1 : 0);
