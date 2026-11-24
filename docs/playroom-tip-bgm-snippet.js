// 플레이룸 툴팁·재생바 진단(읽기만 함). BGM이 재생 중일 때 플레이룸 탭에서 F12 → Console 에 붙여 넣고 Enter,
// 바로 이어서 5초 동안 상단 아이콘과 채팅 톱니 위로 마우스를 천천히 움직이세요. 끝나면 결과가 클립보드에 복사됩니다.
// 담는 것: 코드 판 여부, 재생바·오디오 상태, 포인터 종류, 툴팁 표시 횟수, 페이지 오류. 채팅 본문·이름·음원 주소 본문은 담지 않습니다.
(() => {
  const copyResult = typeof copy === "function" ? copy : null;
  const errors = [], pointers = {}, labels = {};
  let tipShown = 0;
  const onError = (event) => errors.push(String(event.message || event.reason || "").slice(0, 120));
  const onOver = (event) => {
    pointers[event.pointerType || "none"] = (pointers[event.pointerType || "none"] || 0) + 1;
    const button = event.composedPath().find((node) => node instanceof Element && node.matches("button, .bgm-slot"));
    if (button) { const key = button.id || (String(button.getAttribute("aria-label") || "").startsWith("[GM]") ? "[GM]" : "other"); labels[key] = (labels[key] || 0) + 1; }
  };
  addEventListener("error", onError); addEventListener("unhandledrejection", onError); document.addEventListener("pointerover", onOver, true);
  const tip = document.querySelector(".piece-tip");
  const watch = tip ? new MutationObserver(() => { if (!tip.hidden) tipShown += 1; }) : null;
  watch?.observe(tip, { attributes: true, attributeFilter: ["hidden"] });
  const read = (fn) => { try { return fn(); } catch (error) { return `없음(${error.name})`; } };
  const audio = (slot) => read(() => { const el = roomAudio[slot].el, cfg = roomAudio[slot].cfg; return el ? { on: !!roomAudio[slot].url, paused: el.paused, ended: el.ended, loop: el.loop, duration: Math.round(el.duration || 0), t: Math.round(el.currentTime), ready: el.readyState, error: el.error?.code || 0, host: (() => { try { return new URL(el.currentSrc || el.src).host; } catch (_) { return ""; } })(), hasCfg: !!cfg } : null; });
  console.warn("[플레이룸 진단] 5초 동안 상단 아이콘과 톱니 위로 마우스를 움직이세요");
  setTimeout(async () => {
    removeEventListener("error", onError); removeEventListener("unhandledrejection", onError); document.removeEventListener("pointerover", onOver, true); watch?.disconnect();
    const row = document.querySelector("#bgm-bar .bgm-row2"), box = row?.getBoundingClientRect(), style = row && getComputedStyle(row);
    const served = await fetch("/participant.js", { cache: "no-store" }).then((r) => r.text()).catch(() => "");
    const out = {
      code: { loadedTip: read(() => typeof showButtonTip), loadedFile: read(() => typeof playingFile), servedTip: served.includes("function showButtonTip"), css: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => String(r.selectorText || "").includes("bgm-seek")); } catch (_) { return false; } }) },
      window: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, hover: matchMedia("(hover:hover)").matches, finePointer: matchMedia("(pointer:fine)").matches, chatOnly: read(() => chatOnly) },
      pointers, labels, tipShown, tipNode: tip ? { hidden: tip.hidden, parent: tip.parentElement?.tagName, z: getComputedStyle(tip).zIndex } : null,
      bgm: { bgmKey: read(() => !!bgmKey), youtube: read(() => !!ytPlayer), last: read(() => bgmLast?.state || ""), blocked: read(() => blockedAudio), playingFile: read(() => !!playingFile()), media: audio("media"), sound: audio("sound"), row: row ? { hiddenAttr: row.hidden, display: style.display, box: [box.x, box.y, box.width, box.height].map(Math.round) } : null, slot1: document.getElementById("bgm-slot1")?.classList.contains("is-on") },
      cutin: { names: read(() => (sceneData?.cutinNames || []).length), pictures: read(() => (sceneData?.cutinPictures || []).length), servedHide: served.includes("function withoutCutinName"), loadedHide: read(() => typeof withoutCutinName), servedPicture: served.includes("function addCutinPicture"), loadedPicture: read(() => typeof addCutinPicture) },
      fmt: { titlesLeft: document.querySelectorAll("#chat-form .fmt-row [title], #chat-form .fmt-group [title]").length, firstLabelKorean: /[가-힣]/.test(document.querySelector("#chat-form .fmt-row button")?.getAttribute("aria-label") || "") },
      look: row ? (() => { const chain = []; for (let n = row; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.opacity !== "1" || c.visibility !== "visible" || c.filter !== "none" || c.clipPath !== "none" || c.transform !== "none") chain.push([n.id || n.className, c.opacity, c.visibility, c.filter.slice(0, 30), c.clipPath.slice(0, 30), c.transform.slice(0, 30)]); } const seek = document.getElementById("bgm-seek"); return { chain, curColor: getComputedStyle(document.getElementById("bgm-cur")).color, curText: document.getElementById("bgm-cur").textContent, track: getComputedStyle(seek, "::-webkit-slider-runnable-track").backgroundImage.slice(0, 80), p: seek.style.getPropertyValue("--p") }; })() : null,
      cutinLayers: [...document.querySelectorAll(".cutin-layer, .cutin-snack")].length,
      topButtons: [...(document.getElementById("top-host")?.shadowRoot?.querySelectorAll("button") || [])].slice(0, 12).map((b) => [b.getAttribute("aria-label") || "", !!b.title, getComputedStyle(b).pointerEvents]),
      errors: errors.slice(0, 6)
    };
    console.warn("[플레이룸 진단]", out);
    try { copyResult?.(JSON.stringify(out)); console.warn("[플레이룸 진단] 클립보드에 복사했습니다"); } catch (_) { console.warn(JSON.stringify(out)); }
  }, 5000);
})();
