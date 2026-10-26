// Supabase 설정: Supabase 화면 > Project Settings > API 에서 복사해 넣는다 (공개 키만!)
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

// 극장 목록과 지도 위치(지도 상자 안의 %)
const THEATERS = [
  { name: "CGV 제주", x: 42, y: 30 },
  { name: "CGV 제주노형", x: 22, y: 44 },
  { name: "메가박스 제주삼화", x: 74, y: 40 },
  { name: "메가박스 제주아라", x: 50, y: 56 },
  { name: "메가박스 제주서귀포", x: 40, y: 74 },
];

const SESSION_KEY = "neomgyeo-session";

let session = null; // 로그인 정보
let userName = "";
let passes = []; // 불러온 양도글
let zoom = 1;

const $ = (id) => document.getElementById(id);

// ---------- 맨 위 남은 시간 ----------

function pad(n) {
  return String(n).padStart(2, "0");
}

function updateCountdown() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const left = Math.max(0, Math.floor((midnight - now) / 1000));
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  $("countdown").textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;

  // 1분마다 상영 시각이 지난 카드를 목록에서 뺀다
  if (now.getSeconds() === 0 && !$("screen-find").hidden) {
    renderFind();
  }
}

// ---------- 화면 바꾸기 ----------

function showScreen(name) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.id !== `screen-${name}`;
  }
  $("user-area").hidden = name === "login";
  window.scrollTo(0, 0);
}

// ---------- Supabase 주고받기 ----------

function isConfigured() {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Number(data.expires_in) * 1000,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

async function supabaseFetch(path, options = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (session) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// 로그인이 곧 끝나면 새로 받아 둔다
async function refreshIfNeeded() {
  if (!session || session.expires_at - Date.now() > 60 * 1000) return;
  const data = await supabaseFetch("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  saveSession(data);
}

function pickName(user) {
  const meta = user.user_metadata || {};
  const name =
    meta.name ||
    meta.full_name ||
    meta.nickname ||
    meta.preferred_username ||
    (user.email || "").split("@")[0] ||
    "손님";
  return `${name}님`;
}

// ---------- 로그인과 로그아웃 ----------

function login(provider) {
  if (!isConfigured()) {
    $("login-message").textContent = "script.js 맨 위에 Supabase 주소와 공개 키를 넣어 주세요";
    return;
  }
  const back = window.location.origin + window.location.pathname;
  window.location.href =
    `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}` +
    `&redirect_to=${encodeURIComponent(back)}`;
}

async function logout() {
  try {
    await supabaseFetch("/auth/v1/logout", { method: "POST" });
  } catch (error) {
    // 이미 끝난 로그인이어도 화면은 로그아웃한다
  }
  clearSession();
  showScreen("login");
}

// 카카오·구글에서 돌아오면 주소 뒤(#)에 로그인 정보가 붙어 온다
function readLoginFromAddress() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.get("access_token")) {
    saveSession({
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
      expires_in: params.get("expires_in") || 3600,
    });
  }
  if (window.location.hash) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

async function start() {
  if (!isConfigured()) {
    showScreen("login");
    return;
  }
  readLoginFromAddress();
  if (!session) {
    session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  }
  if (!session) {
    showScreen("login");
    return;
  }
  try {
    await refreshIfNeeded();
    const user = await supabaseFetch("/auth/v1/user");
    userName = pickName(user);
    $("user-name").textContent = userName;
    $("choose-question").textContent = `${userName}, 오늘 무엇을 할까요?`;
    showScreen("choose");
  } catch (error) {
    clearSession();
    showScreen("login");
  }
}

// ---------- 넘기기: 양도글 올리기 ----------

function openGive() {
  $("give-form").reset();
  $("give-message").textContent = "";
  showScreen("give");
}

async function submitPass() {
  const link = $("give-link").value.trim();
  const theater = $("give-theater").value;
  const title = $("give-title").value.trim();
  const time = $("give-time").value;
  const priceText = $("give-price").value.trim().replaceAll(",", "");
  const message = $("give-message");

  if (!link || !theater || !title || !time || !priceText) {
    message.textContent = "링크, 극장, 영화, 상영 시각, 가격을 적어 주세요";
    return;
  }
  const price = Number(priceText);
  if (!/^\d+$/.test(priceText) || price < 0) {
    message.textContent = "가격은 숫자로 적어 주세요";
    return;
  }
  if (!link.startsWith("http://") && !link.startsWith("https://")) {
    message.textContent = "주소를 그대로 붙여 넣어 주세요";
    return;
  }
  const [hour, minute] = time.split(":").map(Number);
  const showAt = new Date();
  showAt.setHours(hour, minute, 0, 0);
  if (showAt <= new Date()) {
    message.textContent = "이미 지난 시각이에요";
    return;
  }

  message.textContent = "";
  $("submit-button").disabled = true;
  try {
    await refreshIfNeeded();
    await supabaseFetch("/rest/v1/passes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        link,
        theater,
        title,
        show_at: showAt.toISOString(),
        price,
        author_name: userName,
      }),
    });
    await openFind();
  } catch (error) {
    message.textContent = "올리지 못했어요. 잠시 뒤 다시 눌러 주세요";
  } finally {
    $("submit-button").disabled = false;
  }
}

// ---------- 넘겨받기: 양도글 찾기 ----------

async function openFind() {
  resetFilters();
  showScreen("find");
  $("list-message").textContent = "";
  try {
    await refreshIfNeeded();
    const now = new Date().toISOString();
    passes = await supabaseFetch(
      `/rest/v1/passes?select=*&show_at=gt.${encodeURIComponent(now)}&order=show_at.asc`
    );
  } catch (error) {
    passes = [];
    $("list-message").textContent = "양도글을 불러오지 못했어요";
  }
  fillMovieOptions();
  renderFind();
}

function fillMovieOptions() {
  const select = $("filter-movie");
  const chosen = select.value;
  const titles = [...new Set(passes.map((pass) => pass.title))].sort();
  select.replaceChildren(new Option("모든 영화", ""));
  for (const title of titles) {
    select.add(new Option(title, title));
  }
  select.value = titles.includes(chosen) ? chosen : "";
}

function resetFilters() {
  $("filter-theater").value = "";
  $("filter-movie").value = "";
  $("filter-time").value = "";
}

function selectTheater(name) {
  $("filter-theater").value = name;
  renderFind();
}

function matchesTime(date, range) {
  const hour = date.getHours();
  if (range === "morning") return hour < 12;
  if (range === "afternoon") return hour >= 12 && hour < 18;
  if (range === "evening") return hour >= 18;
  return true;
}

// 영화·상영 시간 조건에 맞고 아직 상영 전인 양도글 (극장은 따로 본다)
function visiblePasses() {
  const movie = $("filter-movie").value;
  const range = $("filter-time").value;
  const now = new Date();
  return passes
    .filter((pass) => new Date(pass.show_at) > now)
    .filter((pass) => !movie || pass.title === movie)
    .filter((pass) => matchesTime(new Date(pass.show_at), range))
    .sort((a, b) => new Date(a.show_at) - new Date(b.show_at));
}

function formatTime(iso) {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPrice(price) {
  return Number(price) === 0 ? "무료" : `${Number(price).toLocaleString("ko-KR")}원`;
}

function renderFind() {
  const theater = $("filter-theater").value;
  const shown = visiblePasses();

  $("theater-title").textContent = theater || "전체 극장";
  renderMap(shown, theater);

  const list = theater ? shown.filter((pass) => pass.theater === theater) : shown;
  $("cards").replaceChildren(...list.map(makeCard));
  $("empty-message").hidden = list.length > 0;
}

function renderMap(shown, selected) {
  const canvas = $("map-canvas");
  canvas.style.width = `${zoom * 100}%`;
  canvas.style.height = `${zoom * 100}%`;
  for (const old of canvas.querySelectorAll(".marker")) old.remove();

  for (const theater of THEATERS) {
    const count = shown.filter((pass) => pass.theater === theater.name).length;
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "marker" + (theater.name === selected ? " selected" : "");
    marker.style.left = `${theater.x}%`;
    marker.style.top = `${theater.y}%`;

    const bubble = document.createElement("span");
    bubble.className = "marker-bubble";
    bubble.textContent = `${count}건 ${theater.name}`;
    const dot = document.createElement("span");
    dot.className = "marker-dot";
    marker.append(bubble, dot);

    marker.addEventListener("click", () => selectTheater(theater.name));
    canvas.append(marker);
  }
}

function makeCard(pass) {
  const card = document.createElement("article");
  card.className = "card";
  card.tabIndex = 0;

  const top = document.createElement("div");
  top.className = "card-top";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "양도 진행 중";
  const time = document.createElement("span");
  time.textContent = formatTime(pass.show_at);
  top.append(badge, time);

  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = pass.title;

  const theater = document.createElement("button");
  theater.type = "button";
  theater.className = "card-theater";
  theater.textContent = `${pass.theater} ›`;
  theater.addEventListener("click", (event) => {
    event.stopPropagation(); // 극장 이름은 링크 대신 극장 고르기
    selectTheater(pass.theater);
  });

  const author = document.createElement("span");
  author.className = "card-author";
  author.textContent = pass.author_name;

  const bottom = document.createElement("div");
  bottom.className = "card-bottom";
  const go = document.createElement("span");
  go.className = "card-go";
  go.textContent = "양도글 보러 가기 ↗";
  const price = document.createElement("span");
  price.className = "card-price";
  price.textContent = formatPrice(pass.price);
  bottom.append(go, price);

  card.append(top, title, theater, author, bottom);

  const openLink = () => {
    if (/^https?:\/\//.test(pass.link)) {
      window.open(pass.link, "_blank", "noopener");
    }
  };
  card.addEventListener("click", openLink);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target === card) openLink();
  });
  return card;
}

function changeZoom(step) {
  zoom = Math.min(2.5, Math.max(1, zoom + step));
  renderFind();
}

// ---------- 처음 준비 ----------

function fillTheaterOptions() {
  $("give-theater").add(new Option("극장을 골라 주세요", ""));
  $("filter-theater").add(new Option("전체 극장", ""));
  for (const theater of THEATERS) {
    $("give-theater").add(new Option(theater.name, theater.name));
    $("filter-theater").add(new Option(theater.name, theater.name));
  }
}

fillTheaterOptions();
$("filter-movie").add(new Option("모든 영화", ""));

$("kakao-button").addEventListener("click", () => login("kakao"));
$("google-button").addEventListener("click", () => login("google"));
$("logout-button").addEventListener("click", logout);
$("give-button").addEventListener("click", openGive);
$("take-button").addEventListener("click", openFind);
for (const button of document.querySelectorAll(".back-button")) {
  button.addEventListener("click", () => showScreen("choose"));
}

$("submit-button").addEventListener("click", submitPass);
$("give-form").addEventListener("submit", (event) => event.preventDefault());

$("filter-theater").addEventListener("change", renderFind);
$("filter-movie").addEventListener("change", renderFind);
$("filter-time").addEventListener("change", renderFind);
$("reset-button").addEventListener("click", () => {
  resetFilters();
  renderFind();
});
$("clear-theater-button").addEventListener("click", () => selectTheater(""));
$("zoom-in").addEventListener("click", () => changeZoom(0.5));
$("zoom-out").addEventListener("click", () => changeZoom(-0.5));

updateCountdown();
setInterval(updateCountdown, 1000);
start();
