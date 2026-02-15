const socket = io();
const peer = new RTCPeerConnection();

let user = JSON.parse(localStorage.getItem("user"));
let channel;
let isSender = false;

// UI refs
const onBoarding = document.getElementById("onBoarding");
const connectFriendCnt = document.getElementById("connectFriend");
const chatUI = document.getElementById("chat");
const statusEl = document.getElementById("status");
const msgBox = document.getElementById("message");
const friendEmail = document.getElementById("friendEmail");

console.log("[INIT] Loaded user:", user);

if (user) {
  onBoarding.style.display = "none";
  connectFriendCnt.style.display = "block";
  socket.emit("save-user", user);
}

function saveEmail() {
  const email = userEmail.value.trim();
  const name = userName.value.trim();
  user = { email, name };
  localStorage.setItem("user", JSON.stringify(user));
  socket.emit("save-user", user);
  onBoarding.style.display = "none";
  connectFriendCnt.style.display = "block";
}

socket.on("user-saved", (res) => {
  msgBox.innerText = res.message;
});

function setStatus(text) {
  statusEl.innerText = text;
  console.log("[STATUS]", text);
}

/* -------------------- CONNECT -------------------- */

async function connectFriend() {
  isSender = true;
  console.log("[RTC] Creating DataChannel");
  channel = peer.createDataChannel("data");

  setupChannel();

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  console.log("[SDP] Offer created");
  socket.emit("offer", {
    from: user.email,
    to: friendEmail.value.trim(),
    offer,
  });
}

socket.on("offer", async ({ from, offer }) => {
  if (isSender) return;

  console.log("[SDP] Offer received");
  await peer.setRemoteDescription(offer);

  peer.ondatachannel = (e) => {
    channel = e.channel;
    setupChannel();
  };

  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  socket.emit("answer", {
    from: user.email,
    to: from,
    answer,
  });
});

socket.on("answer", async ({ answer }) => {
  console.log("[SDP] Answer received");
  await peer.setRemoteDescription(answer);
});

/* -------------------- ICE -------------------- */

peer.onicecandidate = (e) => {
  if (e.candidate) {
    console.log("[ICE] Sending candidate");
    socket.emit("ice-candidates", {
      from: user.email,
      to: friendEmail.value.trim(),
      iceCandidate: e.candidate,
    });
  }
};

socket.on("set-iceCandidates", async ({ iceCandidate }) => {
  console.log("[ICE] Candidate received");
  await peer.addIceCandidate(iceCandidate);
});

/* -------------------- DATACHANNEL -------------------- */

function setupChannel() {
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    console.log("[DC] Channel open");
    setStatus("CONNECTED");
    chatUI.style.display = "block";
  };

  channel.onclose = () => {
    console.log("[DC] Channel closed");
    setStatus("DISCONNECTED");
  };

  channel.onmessage = handleIncomingData;
}

/* -------------------- TEXT -------------------- */

function sendText() {
  const text = document.getElementById("textMsg").value;
  console.log("[SEND] Text:", text);
  channel.send(JSON.stringify({ type: "text", value: text }));
}

/* -------------------- FILE TRANSFER -------------------- */

const CHUNK_SIZE = 16 * 1024;
let received = [];
let receivedSize = 0;
let fileMeta = null;

function sendFile() {
  const file = document.getElementById("fileInput").files[0];

  console.log("[SEND] File meta", file.name, file.size);

  channel.send(
    JSON.stringify({ type: "meta", name: file.name, size: file.size })
  );

  let offset = 0;
  const reader = new FileReader();

  reader.onload = (e) => {
    channel.send(e.target.result);
    offset += e.target.result.byteLength;
    console.log(`[SEND] Chunk ${offset}/${file.size}`);
    if (offset < file.size) readSlice(offset);
  };

  function readSlice(o) {
    reader.readAsArrayBuffer(file.slice(o, o + CHUNK_SIZE));
  }

  readSlice(0);
}

function handleIncomingData(e) {
  if (typeof e.data === "string") {
    const msg = JSON.parse(e.data);

    if (msg.type === "text") {
      console.log("[RECV] Text:", msg.value);
    }

    if (msg.type === "meta") {
      fileMeta = msg;
      received = [];
      receivedSize = 0;
      console.log("[RECV] File meta", msg);
    }
    return;
  }

  received.push(e.data);
  receivedSize += e.data.byteLength;
  console.log(`[RECV] Chunk ${receivedSize}/${fileMeta.size}`);

  if (receivedSize === fileMeta.size) {
    const blob = new Blob(received);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileMeta.name;
    a.click();
    console.log("[RECV] File completed");
  }
}
