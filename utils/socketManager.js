const User = require('../models/User');

const setupSocket = (io) => {
    // Track online users
    const onlineUsers = new Map();

    io.on('connection', (socket) => {
        console.log('🔌 New client connected:', socket.id);

        // User joins their personal room
        socket.on('join', async (data) => {
            const { userId } = data;
            
            if (userId) {
                // Join personal room
                socket.join(`user:${userId}`);
                
                // Update user's socket ID
                try {
                    await User.findByIdAndUpdate(userId, { socketId: socket.id });
                    
                    // Track online user
                    onlineUsers.set(userId, {
                        socketId: socket.id,
                        userId: userId,
                        connectedAt: new Date()
                    });
                    
                    console.log(`✅ User ${userId} joined personal room`);
                    
                    // Notify user of successful connection
                    socket.emit('connected', {
                        message: 'Successfully connected',
                        socketId: socket.id
                    });
                } catch (error) {
                    console.error('Error updating socket ID:', error);
                }
            }
        });

        // Join goal room
        socket.on('joinGoalRoom', (data) => {
            const { goalId } = data;
            
            if (goalId) {
                socket.join(`goal:${goalId}`);
                console.log(`👥 User joined goal room: ${goalId}`);
                
                // Notify others in the room
                socket.to(`goal:${goalId}`).emit('userJoinedRoom', {
                    socketId: socket.id,
                    timestamp: new Date()
                });
            }
        });

        // Leave goal room
        socket.on('leaveGoalRoom', (data) => {
            const { goalId } = data;
            
            if (goalId) {
                socket.leave(`goal:${goalId}`);
                console.log(`👋 User left goal room: ${goalId}`);
            }
        });

        // Handle typing indicator
        socket.on('typing', (data) => {
            const { goalId, userId, userName } = data;
            
            socket.to(`goal:${goalId}`).emit('userTyping', {
                userId,
                userName
            });
        });

        // Handle disconnect
        socket.on('disconnect', async () => {
            console.log('🔌 Client disconnected:', socket.id);
            
            // Find and update user
            for (const [userId, userData] of onlineUsers.entries()) {
                if (userData.socketId === socket.id) {
                    try {
                        await User.findByIdAndUpdate(userId, { socketId: null });
                        onlineUsers.delete(userId);
                        console.log(`❌ User ${userId} disconnected`);
                    } catch (error) {
                        console.error('Error clearing socket ID:', error);
                    }
                    break;
                }
            }
        });

        // Handle ping/pong for connection health
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: new Date() });
        });
    });

    // Periodic cleanup of stale connections
    setInterval(async () => {
        const now = new Date();
        for (const [userId, userData] of onlineUsers.entries()) {
            const connectedTime = now - userData.connectedAt;
            // If connected for more than 24 hours, consider it stale
            if (connectedTime > 24 * 60 * 60 * 1000) {
                try {
                    await User.findByIdAndUpdate(userId, { socketId: null });
                    onlineUsers.delete(userId);
                } catch (error) {
                    console.error('Error cleaning up stale connection:', error);
                }
            }
        }
    }, 60 * 60 * 1000); // Run every hour
};

module.exports = setupSocket;