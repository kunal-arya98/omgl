// Comprehensive Omegle Cricket Game - Game Logic and WebRTC Implementation

// DOM Element References
// These references will help us interact with various HTML elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const connectionMessageEl = document.getElementById('connection-message');
const gameMessageEl = document.getElementById('game-message');

// WebSocket and WebRTC Setup
// We'll use WebSocket for signaling and WebRTC for peer-to-peer video communication
const ws = new WebSocket('ws://localhost:3000');
let peerConnection;  // RTCPeerConnection for video communication
let localStream;     // User's local media stream
let remoteStream;    // Remote user's media stream
let isInitiator = false;  // Determines if this client initiates the connection
let streamActive = true;  // Track if our stream is currently active
let clientId = null;      // Our unique client ID from the server
let partnerId = null;     // Our partner's unique client ID

// Check local storage for previous client ID
const storedClientId = localStorage.getItem('omgl_client_id');
let attemptingReconnect = !!storedClientId;

// WebRTC Configuration
// STUN servers help traverse NAT and establish peer connections
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Game State Variables
// These track the current state of the game across different phases
let gamePhase = 'waiting';     // Current game phase
let isTossWinner = false;      // Did this player win the toss?
let role = null;               // Player's current role (batsman/bowler)
let scores = { you: 0, opponent: 0 };  // Score tracking
let target = null;             // Target score in second innings
let currentTurn = null;        // Whose turn is it currently?
let bowlerSelection = null;    // Number selected by bowler
let batsmanSelection = null;   // Number selected by batsman

// DOM Element References for Game Interaction
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

// WebRTC Video Initialization
// Handles setting up local video and establishing peer connection
async function initializeWebRTC() {
    try {
        // Check if we already have an active stream from another tab
        if (!localStream || !streamActive) {
            // Request camera and microphone access
            const constraints = {
                video: { width: { ideal: 640 }, height: { ideal: 480 } },
                audio: true
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            localVideo.srcObject = localStream;
            streamActive = true;
        }

        // Create peer connection
        peerConnection = new RTCPeerConnection(configuration);

        // Add local tracks to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // Handle incoming remote tracks
        peerConnection.ontrack = (event) => {
            remoteStream = event.streams[0];
            remoteVideo.srcObject = remoteStream;
            connectionMessageEl.textContent = 'Connected with partner!';
        };

        // Handle ICE candidate generation
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    isInitiator: isInitiator
                }));
            }
        };

        // Create and send offer if this client is the initiator
        if (isInitiator) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            ws.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                isInitiator: true
            }));
        }
    } catch (error) {
        console.error('WebRTC initialization error:', error);
        connectionMessageEl.textContent = 'Failed to access camera/microphone';
    }
}

// WebSocket Message Handling
// Processes different types of messages from the server
ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
        case 'client-id':
            // Store our client ID
            clientId = data.clientId;
            localStorage.setItem('omgl_client_id', clientId);
            
            // If we're reconnecting, send previous ID
            if (attemptingReconnect && storedClientId) {
                ws.send(JSON.stringify({
                    type: 'reconnect',
                    clientId: storedClientId
                }));
            } else {
                // New connection, join pool
                ws.send(JSON.stringify({ 
                    type: 'join',
                    previousId: storedClientId // Send null or previous ID if exists
                }));
            }
            break;
            
        case 'peer-assignment':
            // Server assigns initiator status
            isInitiator = data.isInitiator;
            partnerId = data.partnerId;
            initializeWebRTC();
            break;
            
        case 'reconnect-success':
            // Successfully reconnected
            isInitiator = data.isInitiator;
            partnerId = data.partnerId;
            connectionMessageEl.textContent = 'Reconnected with your partner!';
            initializeWebRTC();
            break;

        case 'partner-disconnected':
            if (data.temporary) {
                connectionMessageEl.textContent = 'Partner temporarily disconnected. Waiting for reconnection...';
            } else {
                connectionMessageEl.textContent = 'Partner disconnected. Searching for new partner...';
                resetGame();
            }
            break;
            
        case 'partner-reconnected':
            connectionMessageEl.textContent = 'Partner reconnected!';
            break;

        case 'offer':
            // Handle incoming connection offer
            if (!isInitiator) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                ws.send(JSON.stringify({
                    type: 'answer',
                    answer: answer,
                    isInitiator: false
                }));
            }
            break;

        case 'answer':
            // Handle connection answer
            if (isInitiator) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
            break;

        case 'ice-candidate':
            // Handle network routing information
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (error) {
                console.error('ICE candidate error:', error);
            }
            break;

        // Game-specific message types
        case 'toss':
            handleTossResult(data);
            break;

        case 'role':
            handleRoleSelection(data);
            break;

        case 'number':
            handleNumberSelection(data);
            break;
    }
};

// Toss Mechanics
function sendTossChoice(choice) {
    const tossResult = Math.random() < 0.5 ? 'heads' : 'tails';
    isTossWinner = tossResult === choice;
    ws.send(JSON.stringify({ 
        type: 'toss', 
        choice, 
        winner: isTossWinner ? 'you' : 'opponent' 
    }));
}

function handleTossResult(data) {
    isTossWinner = data.winner === 'you';
    gamePhase = 'choose_role';
    gameMessageEl.textContent = isTossWinner ? 'You won the toss!' : 'Opponent won the toss.';
    updateUI();
}

// Role Selection Mechanics
function sendRoleChoice(choice) {
    role = choice === 'bat' ? 'batsman' : 'bowler';
    ws.send(JSON.stringify({ type: 'role', role: choice }));
}

function handleRoleSelection(data) {
    const { role: selectedRole } = data;
    role = isTossWinner 
        ? (selectedRole === 'bat' ? 'batsman' : 'bowler')
        : (selectedRole === 'bat' ? 'bowler' : 'batsman');
    gamePhase = 'first_innings';
    currentTurn = 'bowler';
    updateUI();
}

// Number Selection and Game Progression
function handleNumberSelection(data) {
    const { number, role: senderRole } = data;
    
    if (senderRole === 'bowler') {
        bowlerSelection = number;
        currentTurn = 'batsman';
        gameMessageEl.textContent = 'Bowler has selected a number. Your turn to bat!';
    } else if (senderRole === 'batsman') {
        batsmanSelection = number;
        
        if (batsmanSelection !== bowlerSelection) {
            // Runs scored
            const scoringTeam = senderRole === role ? 'you' : 'opponent';
            scores[scoringTeam] += batsmanSelection;
            
            gameMessageEl.textContent = `${scoringTeam === 'you' ? 'You' : 'Opponent'} scored ${batsmanSelection} runs!`;
            
            // Check for game progression
            if (gamePhase === 'second_innings' && scores.you > target) {
                gamePhase = 'game_over';
                gameMessageEl.textContent = 'You won the game!';
            }
        } else {
            // Batsman is out
            gameMessageEl.textContent = 'Batsman is out!';
            
            if (gamePhase === 'first_innings') {
                // End of first innings
                target = scores.you || scores.opponent;
                scores = { you: 0, opponent: 0 };
                role = role === 'batsman' ? 'bowler' : 'batsman';
                gamePhase = 'second_innings';
            } else {
                // End of second innings
                gamePhase = 'game_over';
                gameMessageEl.textContent = 'Game Over! ' + 
                    (scores.you > scores.opponent ? 'You won!' : 'Opponent won!');
            }
            
            currentTurn = 'bowler';
        }
        
        updateUI();
    }
}

// UI Update and Game State Management
function updateUI() {
    // Hide all sections initially
    [tossSection, roleSection, numberSection, playAgainBtn, changePartnerBtn]
        .forEach(el => el.classList.add('hidden'));

    // Disable all buttons
    numberButtons.forEach(btn => btn.disabled = true);
    [headsBtn, tailsBtn, batBtn, bowlBtn].forEach(btn => btn.disabled = false);

    // Update scores
    scoreYouEl.textContent = scores.you;
    scoreOpponentEl.textContent = scores.opponent;

    // Game phase specific UI updates
    switch (gamePhase) {
        case 'toss':
            tossSection.classList.remove('hidden');
            gameMessageEl.textContent = 'Click Heads or Tails to toss.';
            break;

        case 'choose_role':
            if (isTossWinner) {
                roleSection.classList.remove('hidden');
                gameMessageEl.textContent = 'You won the toss. Choose to bat or bowl.';
            }
            break;

        case 'first_innings':
        case 'second_innings':
            numberSection.classList.remove('hidden');
            changePartnerBtn.classList.remove('hidden');

            if (currentTurn === role) {
                numberButtons.forEach(btn => btn.disabled = false);
                gameMessageEl.textContent = `Your turn as ${role}. Select a number (1-5).`;
            } else {
                gameMessageEl.textContent = `Waiting for opponent to select a number.`;
            }

            if (gamePhase === 'second_innings' && target) {
                gameMessageEl.textContent += ` Target: ${target}`;
            }
            break;

        case 'game_over':
            playAgainBtn.classList.remove('hidden');
            changePartnerBtn.classList.remove('hidden');
            gameMessageEl.textContent = `Game Over! Final Scores - You: ${scores.you}, Opponent: ${scores.opponent}`;
            break;
    }
}

// Game Reset and Partner Change Functions
function resetGame() {
    gamePhase = 'toss';
    isTossWinner = false;
    role = null;
    scores = { you: 0, opponent: 0 };
    target = null;
    currentTurn = null;
    bowlerSelection = null;
    batsmanSelection = null;
    
    // Don't reset clientId as we want to maintain identity

    updateUI();
    ws.send(JSON.stringify({ 
        type: 'join',
        previousId: storedClientId // Include previous ID for potential reconnection
    }));
}

function changePartner() {
    if (peerConnection) {
        peerConnection.close();
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;

    resetGame();
}

// Event Listeners
headsBtn.addEventListener('click', () => sendTossChoice('heads'));
tailsBtn.addEventListener('click', () => sendTossChoice('tails'));
batBtn.addEventListener('click', () => sendRoleChoice('bat'));
bowlBtn.addEventListener('click', () => sendRoleChoice('bowl'));

numberButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (currentTurn === role) {
            const number = parseInt(btn.textContent);
            ws.send(JSON.stringify({ 
                type: 'number', 
                number, 
                role: role === 'batsman' ? 'batsman' : 'bowler' 
            }));
        }
    });
});

playAgainBtn.addEventListener('click', resetGame);
changePartnerBtn.addEventListener('click', changePartner);

// WebSocket Connection Initialization
ws.onopen = () => {
    connectionMessageEl.textContent = 'Connected to server. Waiting for partner...';
    // Don't send join message here, we'll wait for client-id message first
    updateUI();
};

// Handle page visibility changes
document.addEventListener('visibilitychange', handleVisibilityChange);

function handleVisibilityChange() {
    if (document.hidden) {
        // Tab is hidden, pause video to release camera
        if (localStream && localVideo.srcObject) {
            localStream.getTracks().forEach(track => {
                track.enabled = false;
            });
            streamActive = false;
        }
    } else {
        // Tab is visible again, resume video
        if (localStream) {
            localStream.getTracks().forEach(track => {
                track.enabled = true;
            });
            streamActive = true;
        } else if (peerConnection) {
            // If we're reconnecting and don't have a stream, try to reinitialize
            initializeWebRTC();
        }
    }
}

// Handle tab closing to properly release resources
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
    }
    
    // We keep the client ID in localStorage for reconnection attempts
});

// Initial UI Setup
updateUI();
