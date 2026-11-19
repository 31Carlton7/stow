// Where the app is downloaded from. Every Download button on the site is pointed here.
const DOWNLOAD_URL = "https://github.com/31Carlton7/stow/releases/latest/download/Stow.dmg";

document.documentElement.classList.add("js");

for (const link of document.querySelectorAll("[data-download]")) link.href = DOWNLOAD_URL;

// Privacy and Terms load this file for their Download button and have nothing below to run.
if (document.querySelector(".opening") !== null) runHomePage();

function runHomePage() {
  const stillness = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  // What follows the scroll: the window standing up, and the sentence that lights as it is read.
  const opening = document.querySelector(".opening");
  const litLine = document.querySelector(".lit");
  // A copy of the list: the nodes are replaced as it is walked, and the live list would shift under it.
  for (const node of Array.from(litLine.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.classList.add("w");
      continue;
    }
    const words = document.createDocumentFragment();
    for (const piece of node.textContent.split(/(\s+)/)) {
      if (piece.trim() === "") {
        words.append(piece);
        continue;
      }
      const word = document.createElement("span");
      word.className = "w";
      word.textContent = piece;
      words.append(word);
    }
    node.replaceWith(words);
  }
  const litWords = litLine.querySelectorAll(".w");

  // Only what is on screen is worked on as the page scrolls.
  const onScreen = new Set();
  const watched = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) onScreen.add(entry.target);
      else onScreen.delete(entry.target);
    }
    followScroll();
  });
  watched.observe(opening);
  watched.observe(litLine);

  function followScroll() {
    if (onScreen.has(opening) && !stillness.matches) {
      const scrolled = clamp01(scrollY / (innerHeight * 0.5));
      opening.style.setProperty("--stand", scrolled.toFixed(3));
      opening.style.setProperty("--flow", scrolled.toFixed(3));
    }
    if (!onScreen.has(litLine)) return;
    const box = litLine.getBoundingClientRect();
    const read = clamp01((innerHeight * 0.86 - box.top) / (box.height + innerHeight * 0.36));
    const lit = Math.round(read * litWords.length);
    litWords.forEach((word, i) => word.classList.toggle("on", i < lit));
  }

  let scrollQueued = false;
  addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      followScroll();
    });
  }, { passive: true });

  const tiles = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("seen");
      tiles.unobserve(entry.target);
      if (entry.target.dataset.demo === "dupes") setTimeout(() => gather(true), 900);
    }
  }, { threshold: 0.3 });
  for (const tile of document.querySelectorAll(".tile")) tiles.observe(tile);

  // Review: approve the fix or dismiss the finding, and take either back.
  const finding = document.querySelector(".finding");
  const findingState = finding.querySelector(".finding-state");
  const approve = finding.querySelector("[data-approve]");
  const dismiss = finding.querySelector("[data-dismiss]");
  function decide(decision) {
    finding.dataset.finding = decision;
    findingState.textContent = { waiting: "Waiting", fixed: "Fixed", dismissed: "Dismissed" }[decision];
    approve.textContent = decision === "waiting" ? "Approve" : "Undo";
    approve.classList.toggle("act-primary", decision === "waiting");
    dismiss.hidden = decision !== "waiting";
  }
  approve.addEventListener("click", () => decide(finding.dataset.finding === "waiting" ? "fixed" : "waiting"));
  dismiss.addEventListener("click", () => decide("dismissed"));
  decide("waiting");

  // The model's reading is off until its switch is on. Nothing is sent from this page either way.
  const modelTile = document.querySelector(".tile-model");
  const modelFoot = modelTile.querySelector("[data-model-foot]");
  modelTile.querySelector("[data-model-switch]").addEventListener("change", (event) => {
    const isOn = event.target.checked;
    modelTile.dataset.model = isOn ? "on" : "off";
    modelFoot.textContent = isOn
      ? "On. The app asks through the Claude or Codex command you are already signed in to."
      : "Off. Nothing has been sent anywhere.";
  });

  const copies = document.querySelector("[data-dupes]");
  function gather(asOne) {
    copies.dataset.dupes = asOne ? "one" : "three";
  }
  copies.addEventListener("click", () => gather(copies.dataset.dupes !== "one"));

  // Each server is asked in turn. One is made to fail, to show what a failure looks like.
  const servers = [...document.querySelectorAll(".servers li")];
  const check = document.querySelector("[data-check]");
  function setServer(server, state) {
    server.dataset.state = state;
    server.querySelector("em").textContent = { idle: "", checking: "Checking", ok: "Connects", failed: "Cannot connect" }[state];
  }
  check.addEventListener("click", () => {
    check.disabled = true;
    servers.forEach((server, i) => {
      setServer(server, "idle");
      setTimeout(() => setServer(server, "checking"), i * 450);
      setTimeout(() => {
        setServer(server, "fails" in server.dataset ? "failed" : "ok");
        if (i === servers.length - 1) check.disabled = false;
      }, i * 450 + 700);
    });
  });

  const swatches = [...document.querySelectorAll(".swatches button")];
  for (const swatch of swatches) {
    swatch.addEventListener("click", () => {
      for (const other of swatches) other.setAttribute("aria-checked", String(other === swatch));
      document.documentElement.style.setProperty("--accent", swatch.style.getPropertyValue("--swatch"));
    });
  }

  // The real window: a chip chooses the capture and the line beside it.
  const SCREEN_SAYS = {
    library: ["Every memory and instruction file.", "A grid of cards or a list, grouped by agent or by project, with copies of the same memory collapsed into one."],
    review: ["The exact change, before anything changes.", "Each finding opens to its diff. Approve it or dismiss it, and undo any fix afterwards."],
    health: ["What a session carries.", "What your agents load before your first word, where the storage goes, and what tidying would save."],
    sessions: ["Conversations, indexed in place.", "Transcripts from Claude and Codex, each with what it had loaded."],
    servers: ["MCP servers across agents.", "Where each is defined and whether it connects. Add one or remove one for several agents at once."],
    settings: ["Settings.", "The accent follows your Mac until you pick another, in light and dark."],
  };
  const screens = document.querySelector("[data-screens]");
  const screenSays = document.querySelector("[data-screen-says]");
  const chips = [...document.querySelectorAll(".chips button")];
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      for (const other of chips) other.setAttribute("aria-selected", String(other === chip));
      for (const picture of screens.querySelectorAll("picture")) picture.hidden = picture.dataset.screen !== chip.dataset.screen;
      const [title, rest] = SCREEN_SAYS[chip.dataset.screen];
      const lead = document.createElement("span");
      lead.textContent = title;
      screenSays.replaceChildren(lead, ` ${rest}`);
    });
  }
}
