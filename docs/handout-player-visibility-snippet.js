// 플레이어 화면 점검(읽기만, 본문·비밀 내용 없음) — 그 플레이어의 코코포리아 룸 탭 콘솔에 붙여 넣는다. 결과는 콘솔(warn)과 클립보드(copy)에 들어간다.
// 이 브라우저가 GM 으로 판정되는지, 로컬에 남은 핸드아웃(내게 온 사본이 아닌 것)이 몇 개인지, 화면에 보일 수 있는 것이 몇 개인지. uid 는 앞 6자만.
(() => {
  const d = window.__CCF_HANDOUT_DEBUG__;
  if (!d) { console.warn("핸드아웃 도구가 없습니다(확장·북마클릿 확인)"); return; }
  const cut = (v) => (v ? String(v).slice(0, 6) + "…" : "");
  const seat = (() => { try { return d.seat(); } catch (e) { return { error: String(e) }; } })();
  const out = {
    version: (() => { try { return d.version || null; } catch (_) { return null; } })(),
    visibility: (() => { try { return d.visibilityDiag ? d.visibilityDiag() : "옛 버전(0.1.130 미만): 새로고침 후 다시"; } catch (e) { return String(e); } })(),
    seat: { myUid: cut(seat.myUid), myCcfUid: cut(seat.myCcfUid), role: seat.role, seatGmUid: cut(seat.seat?.gmUid), seatIsMine: !!(seat.seat?.gmUid && seat.myUid && seat.seat.gmUid === seat.myUid) },
    receive: (() => { try { const r = d.receiveDiag(); return { connected: r.connected, inboxActive: r.inboxActive, received: r.received, gm: r.gm }; } catch (e) { return String(e); } })(),
    toolsTitle: document.querySelector("#ccf-gm-tools .ccf-gt-window > header > h2")?.textContent || "(창 닫힘)"
  };
  const text = JSON.stringify(out, null, 1);
  try { copy(text); } catch (_) {}
  console.warn("[handout-player-visibility] 클립보드에 복사했습니다", out);
  return out;
})();
