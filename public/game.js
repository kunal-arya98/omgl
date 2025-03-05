// WebRTC and WebSocket Setup
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const ws = new WebSocket('ws://localhost:3000');
let peerConnection;
let localStream;
let remoteStream;

// Game State
let gamePhase = 'toss';
let isTossWinner = false;
let role = null; // 'batsman' or 'bowler'
let scores = { you: 0, opponent: 0 };
let target = null;
let currentTurn = null;
let bowlerSelection = null;
let batsmanSelection = null;

// DOM Elements
const messageEl = document.getElementById('game-message');
const scoreYouEl = document.getElementById('score-you');
const scoreOpponentEl = document.getElementById('score-opponent');
const tossSection = document.getElementById('toss-section');
const roleSection = document.getElementById('role-section');
const numberSection = document.getElementById('number-section');
const numberButtons = document.querySelectorAll('.number-btn');
const changePartnerBtn = document.getElementById('change-partner');
const playAgainBtn = document.getElementById('play-again');
const headsBtn = document.getElementById('heads');
const tailsBtn = document.getElementById('tails');
const batBtn = document.getElementById('bat');
const bowlBtn = document.getElementById('bowl');

// WebRTC Setup
async function startVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        peerConnection = new RTCPeerConnection();
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
        };
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ type: 'ice', candidate: event.candidate }));
            }
        };
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'offer', offer }));
    } catch (error) {
        console.error('Error starting video:', error);
    }
}

// WebSocket Message Handling
ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer }));
    } else if (data.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } else if (data.type === 'ice') {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else if (data.type === 'toss') {
        handleTossResult(data);
    } else if (data.type === 'role') {
        handleRoleSelection(data);
    } else if (data.type === 'number') {
        handleNumberSelection(data);
    }
};

// Game UI Updates
function updateUI() {
    tossSection.classList.add('hidden');
    roleSection.classList.add('hidden');
    numberSection.classList.add('hidden');
    playAgainBtn.classList.add('hidden');
    changePartnerBtn.classList.add('hidden');

    headsBtn.disabled = false;
    tailsBtn.disabled = false;
    numberButtons.forEach(btn => btn.disabled = true);

    if (gamePhase === 'toss') {
        tossSection.classList.remove('hidden');
        messageEl.textContent = 'Click Heads or Tails to toss.';
    } else if (gamePhase === 'choose_role' && isTossWinner) {
        roleSection.classList.remove('hidden');
        messageEl.textContent = 'You won the toss. Choose to bat or bowl.';
    } else if (gamePhase === 'first_innings' || gamePhase === 'second_innings') {
        numberSection.classList.remove('hidden');
        changePartnerBtn.classList.remove('hidden');
        if (currentTurn === role) {
            messageEl.textContent = `Your turn as ${role}. Select a number (1-5).`;
            numberButtons.forEach(btn => btn.disabled = false);
        } else {
            messageEl.textContent = `Waiting for opponent to select a number.`;
        }
    } else if (gamePhase === 'game_over') {
        playAgainBtn.classList.remove('hidden');
        changePartnerBtn.classList.remove('hidden');
        messageEl.textContent = `Game Over! Final Scores - You: ${scores.you}, Opponent: ${scores.opponent}`;
    }

    scoreYouEl.textContent = scores.you;
    scoreOpponentEl.textContent = scores.opponent;
}

// Toss Handling
headsBtn.addEventListener('click', () => sendTossChoice('heads'));
tailsBtn.addEventListener('click', () => sendTossChoice('tails'));

function sendTossChoice(choice) {
    const tossResult = Math.random() < 0.5 ? 'heads' : 'tails';
    isTossWinner = tossResult === choice;
    ws.send(JSON.stringify({ type: 'toss', choice, winner: isTossWinner ? 'you' : 'opponent' }));
}

function handleTossResult(data) {
    isTossWinner = data.winner === 'you';
    gamePhase = 'choose_role';
    messageEl.textContent = isTossWinner ? 'You won the toss!' : 'Opponent won the toss.';
    updateUI();
}

// Role Selection
batBtn.addEventListener('click', () => sendRoleChoice('bat'));
bowlBtn.addEventListener('click', () => sendRoleChoice('bowl'));

function sendRoleChoice(choice) {
    role = choice === 'bat' ? 'batsman' : 'bowler';
    ws.send(JSON.stringify({ type: 'role', role: choice }));
}

function handleRoleSelection(data) {
    const { role: selectedRole } = data;
    role = isTossWinner ? (selectedRole === 'bat' ? 'batsman' : 'bowler') : (selectedRole === 'bat' ? 'bowler' : 'batsman');
    gamePhase = 'first_innings';
    currentTurn = 'bowler';
    updateUI();
}

// Number Selection
numberButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const number = parseInt(btn.textContent);
        ws.send(JSON.stringify({ type: 'number', number, role }));
    });
});

function handleNumberSelection(data) {
    const { number, role: senderRole } = data;
    if (senderRole === 'bowler') {
        bowlerSelection = number;
        currentTurn = 'batsman';
    } else if (senderRole === 'batsman') {
        batsmanSelection = number;
        if (batsmanSelection !== bowlerSelection) {
            scores[senderRole === role ? 'you' : 'opponent'] += batsmanSelection;
            if (gamePhase === 'second_innings' && scores.you > target) {
                gamePhase = 'game_over';
            }
        } else {
            if (gamePhase === 'first_innings') {
                target = scores.you || scores.opponent;
                scores = { you: 0, opponent: 0 };
                role = role === 'batsman' ? 'bowler' : 'batsman';
                gamePhase = 'second_innings';
            } else {
                gamePhase = 'game_over';
            }
        }
        currentTurn = 'bowler';
    }
    updateUI();
}

// Play Again
playAgainBtn.addEventListener('click', () => {
    gamePhase = 'toss';
    isTossWinner = false;
    role = null;
    scores = { you: 0, opponent: 0 };
    target = null;
    currentTurn = null;
    updateUI();
});

// Initialize
startVideo();
updateUI();
