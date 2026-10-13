// Rules for objects a participant creates in the GM's room (characters, panels, ...): who may create, how fast, how many, and who owns what.
// CCFOLIA documents are created under the GM's account, so the relay keeps its own ledger { objectId -> participantId }; a participant may change or delete only what they made.
export const CREATE_LIMITS = Object.freeze({ perMinute: 10, perRoom: 200, windowMs: 60_000 });

// room: the stored room record (capabilities.participantCreate, created, createLog); member: { id }.
export function checkCreate(room, member, now = Date.now()) {
  if (room.capabilities?.participantCreate === false) return { ok: false, status: 403, error: "GM이 참여자의 생성을 허용하지 않았습니다." };
  const created = room.created || {};
  if (Object.keys(created).length >= CREATE_LIMITS.perRoom) return { ok: false, status: 429, error: "참여자가 만든 오브젝트가 너무 많습니다." };
  const recent = (room.createLog?.[member.id] || []).filter(at => now - at < CREATE_LIMITS.windowMs);
  if (recent.length >= CREATE_LIMITS.perMinute) return { ok: false, status: 429, error: "잠시 후 다시 만들어 주세요." };
  return { ok: true };
}
// one attempt (counted when a create request is accepted, whether or not the GM manages to carry it out)
export function logCreate(room, member, now = Date.now()) {
  const log = room.createLog ||= {};
  log[member.id] = [...(log[member.id] || []).filter(at => now - at < CREATE_LIMITS.windowMs), now];
}
// the object now exists in the room: its maker is remembered
export function recordCreate(room, member, objectId) {
  room.created = { ...(room.created || {}), [objectId]: member.id };
}
export const ownsObject = (room, member, objectId) => !!objectId && room.created?.[objectId] === member.id;
export function forgetObject(room, objectId) { if (room.created) delete room.created[objectId]; }
// the ledger only keeps what is still in the room: objects the GM removed are dropped
export function pruneCreated(room, existingIds) {
  const alive = new Set(existingIds);
  for (const id of Object.keys(room.created || {})) if (!alive.has(id)) delete room.created[id];
}
