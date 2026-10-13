# Firestore rules of the handout tool (`ccfolia-handout-25c6b`)

`firestore.rules` is a **draft**. Nothing here is published by the repository; rules are published by hand in the Firebase console (see the end).

## The rules that are published today (as copied from the console, 2026-10-13)

```
rooms/{roomId}/handouts/{handoutId}   read: signed in (anonymous sign-in counts)
                                      create, update: signed in && request.resource.data.ownerUid == auth.uid
                                      delete: signed in && resource.data.ownerUid == auth.uid
rooms/{roomId}/presence/{uid}         read: signed in; write, delete: auth.uid == uid
rooms/{roomId}/shows/{showId}         read: signed in; create: request.resource.data.atUid == auth.uid; delete: resource.data.atUid == auth.uid
rooms/{roomId}/meta/{docId}           read, write: signed in
rooms/{roomId}/images/{imageId}, chunks/{chunkId}   read, create, update, delete: signed in
(everything else: denied, so rooms/{roomId}/members is denied today)
```

What follows from them:
1. **Secrets leak**: `handouts` is readable by anybody signed in, anonymous included, so the secret text (`gmNotes`) and handouts a person has no right to are readable by anybody who knows the room key and uses the project's public web config (the permission check is made only on the receiving side).
2. **Takeover of a handout**: `update` only checks the *new* `ownerUid`; anybody can overwrite another person's handout after setting `ownerUid` to their own uid (the tool itself relies on this: "delete failed -> overwrite ownerUid -> delete again").
3. **GM seat**: `meta/*` is writable by anybody signed in, so anybody can overwrite `meta/gm` (take the GM seat) or `meta/folders`.
4. **Pictures** can be deleted or overwritten by anybody signed in.
5. `members` has no rule, so the account registration of handout tool 0.1.94 is refused until a rule exists (the tool logs one warning and goes on).

## What the draft changes

| Path | Draft |
|---|---|
| `handouts/{id}` (originals, with the secret text) | GM only (read and write) |
| `inbox/{uid}/handouts/{id}` (what one person may read) | the person reads, the GM writes |
| `members/{uid}` | the person writes only their own record (`ccfoliaUid`, `displayName`, `updatedAt`), the person and the GM read |
| `meta/gm` | read: signed in; create: anybody (first writer); update: the current GM, or a client that carries the same `gmCcfoliaUid` (see the risk below) |
| other `meta/*` (folders) | read: signed in; write: GM |
| `shows/{id}` | create and delete: GM |
| `presence/{uid}` | as today |
| `images/{id}`, `chunks` | read by id (no listing of pictures), write: GM |

### Known weakness (said plainly)
The GM seat can be taken back on another browser by a client that writes `meta/gm` with the same `gmCcfoliaUid`. That claim is made by the client: **a player who learns the owner's CCFOLIA account uid can take the GM seat** (CCFOLIA shows the owner uid to the room's members in its own data, so a technically capable player can find it). It is still much better than today (anybody can take it with no knowledge). A real fix needs something only the owner has (for example a secret stored with the owner's CCFOLIA account); the alternative is to forbid the claim and let the GM seat change only by deleting `meta/gm` by hand in the console.

## Order of the migration (do not publish the rules first)
1. Release the handout tool that writes **inbox copies** for each person and reads its own inbox (handout-overhaul stage 2); GMs update first.
2. Publish `firestore.rules`.
3. The GM opens the room once: the tool moves the existing handouts into the new structure and empties the secret text of the shared originals.
4. Players update the tool. **After step 2 a player whose tool is the old version no longer receives handouts** (it reads `handouts`, which only the GM can read now) and the old tool can no longer overwrite; ask everybody to update before step 2 if possible.

## Publishing (by the owner, in the Firebase console)
Firebase console -> project `ccfolia-handout-25c6b` -> Firestore Database -> Rules -> paste -> Publish. Keep a copy of the old text above to roll back (Rules tab -> history also keeps earlier versions). With the Firebase CLI: `firebase deploy --only firestore:rules --project ccfolia-handout-25c6b` from a folder that has `firebase.json` pointing at this file.

## Tests
`firebase/rules-test/` runs 53 checks against the Firestore emulator (`cd firebase/rules-test && npm install && npm test`; needs Java): originals GM only, inbox per person, members, the GM seat, folders, shows, presence, pictures, closed paths. The run found one hole in the first draft (a merge update could take the GM seat without knowing the owner uid); the seat takeover now needs a proof document `claims/{gmCcfoliaUid}_{uid}` that the handout tool (0.1.99) creates first. Known weakness that remains: whoever knows the owner CCFOLIA uid can still take the seat.
