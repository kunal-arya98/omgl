const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Track waiting and connected clients
const waitingClients = [];
const connectedPairs = new Map();
// Add unique IDs for clients to handle reconnections
const clientIds = new Map(); // Map WebSocket -> clientId
let nextClientId = 1;

wss.on('connection', (ws) => {
    console.log('New client connected');
    // Generate a unique client ID for this connection
    const clientId = `client-${nextClientId++}`;
    clientIds.set(ws, clientId);

    ws.on('message', (messageStr) => {
        const message = JSON.parse(messageStr);

        switch (message.type) {
            case 'join':
                handleClientJoin(ws, message.previousId);
                break;

            case 'offer':
            case 'answer':
            case 'ice-candidate':
                forwardSignalingMessage(ws, message);
                break;
                
            case 'reconnect':
                handleReconnect(ws, message.clientId);
                break;
        }
    });

    ws.on('close', () => {
        handleClientDisconnect(ws);
    });
    
    // Send the client its unique ID
    ws.send(JSON.stringify({
        type: 'client-id',
        clientId: clientId
    }));
});

function handleClientJoin(ws, previousId) {
    // Check if this is a reconnecting client
    if (previousId) {
        handleReconnect(ws, previousId);
        return;
    }
    
    if (waitingClients.length > 0) {
        const partnerWs = waitingClients.pop();
        
        // Assign roles to the pair
        ws.send(JSON.stringify({ 
            type: 'peer-assignment', 
            isInitiator: true,
            partnerId: clientIds.get(partnerWs)
        }));
        partnerWs.send(JSON.stringify({ 
            type: 'peer-assignment', 
            isInitiator: false,
            partnerId: clientIds.get(ws)
        }));

        // Track the connected pair
        connectedPairs.set(ws, partnerWs);
        connectedPairs.set(partnerWs, ws);
    } else {
        waitingClients.push(ws);
    }
}

function handleReconnect(ws, previousId) {
    console.log(`Client attempting to reconnect with previous ID: ${previousId}`);
    
    // Update the client's ID mapping
    clientIds.set(ws, previousId);
    
    // Check if this client was previously paired
    for (const [existingWs, partnerWs] of connectedPairs.entries()) {
        if (clientIds.get(existingWs) === previousId) {
            // Replace the old connection with the new one
            connectedPairs.delete(existingWs);
            connectedPairs.set(ws, partnerWs);
            connectedPairs.set(partnerWs, ws);
            
            // Notify the partner of reconnection
            partnerWs.send(JSON.stringify({
                type: 'partner-reconnected',
                partnerId: previousId
            }));
            
            // Setup new peer connection for the reconnected client
            ws.send(JSON.stringify({
                type: 'reconnect-success',
                isInitiator: true,
                partnerId: clientIds.get(partnerWs)
            }));
            
            console.log('Reconnection successful');
            return;
        }
    }
    
    // If not found in existing pairs, add to waiting list
    waitingClients.push(ws);
    console.log('No previous pairing found, added to waiting list');
}

function forwardSignalingMessage(sender, message) {
    const partner = connectedPairs.get(sender);
    if (partner) {
        partner.send(JSON.stringify(message));
    }
}

function handleClientDisconnect(ws) {
    console.log('Client disconnected');
    const disconnectedId = clientIds.get(ws);
    
    // Don't immediately remove the client - give them a chance to reconnect
    // Store the clientId in case they reconnect
    
    // Remove from waiting list if applicable
    const waitingIndex = waitingClients.indexOf(ws);
    if (waitingIndex > -1) {
        waitingClients.splice(waitingIndex, 1);
    }

    // Handle pair disconnection
    const partner = connectedPairs.get(ws);
    if (partner) {
        // Don't delete the connection pair immediately
        // Instead notify the partner of temporary disconnection
        partner.send(JSON.stringify({ 
            type: 'partner-disconnected',
            temporary: true,
            partnerId: disconnectedId
        }));
        
        // Set a timeout to fully disconnect if the client doesn't reconnect
        setTimeout(() => {
            // Check if the client has reconnected
            let reconnected = false;
            for (const [existingWs, id] of clientIds.entries()) {
                if (id === disconnectedId && existingWs !== ws) {
                    reconnected = true;
                    break;
                }
            }
            
            if (!reconnected) {
                // Client has not reconnected, do full cleanup
                connectedPairs.delete(ws);
                if (partner && connectedPairs.has(partner)) {
                    connectedPairs.delete(partner);
                    partner.send(JSON.stringify({ 
                        type: 'partner-disconnected',
                        temporary: false 
                    }));
                    waitingClients.push(partner);
                }
                clientIds.delete(ws);
            }
        }, 10000); // Wait 10 seconds for reconnection
    } else {
        // Client wasn't paired, can remove the ID right away
        clientIds.delete(ws);
    }
}

// Start the server
server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
