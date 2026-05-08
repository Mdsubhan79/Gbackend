const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const Goal = require('../models/Goal');
const User = require('../models/User');

// Create Goal
router.post('/create', async (req, res) => {
    try {
        const { userId, goalName, totalDays, mode, maxTeamMembers } = req.body;
        const io = req.app.get('io');

        // Validate user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Create goal
        const goalData = {
            goalName,
            totalDays,
            mode,
            creator: userId,
            status: mode === 'solo' ? 'active' : 'pending',
            currentDay: 1
        };

        if (mode === 'team') {
            goalData.teamLink = uuidv4();
            goalData.maxTeamMembers = maxTeamMembers || 2;
            goalData.teamMembers = [userId];
            goalData.teamProgress = [{
                userId: userId,
                userProgress: []
            }];
        }

        const goal = new Goal(goalData);
        await goal.save();

        // Populate creator and team members
        await goal.populate('creator', 'name email');
        await goal.populate('teamMembers', 'name email');

        // Emit socket event
        if (mode === 'team') {
            io.emit('goalCreated', {
                goalId: goal._id,
                goalName: goal.goalName,
                mode: goal.mode
            });
        }

        res.status(201).json({
            success: true,
            message: 'Goal created successfully',
            goal
        });
    } catch (error) {
        console.error('Goal creation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating goal',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Join Team Goal
router.post('/join', async (req, res) => {
    try {
        const { teamLink, userId } = req.body;
        const io = req.app.get('io');

        // Find goal by team link
        const goal = await Goal.findOne({ teamLink, mode: 'team', status: 'pending' });
        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or expired team link'
            });
        }

        // Check if team is full
        if (goal.teamMembers.length >= goal.maxTeamMembers) {
            return res.status(400).json({
                success: false,
                message: 'Team is already full'
            });
        }

        // Check if user is already in team
        if (goal.teamMembers.includes(userId)) {
            return res.status(400).json({
                success: false,
                message: 'You are already a team member'
            });
        }

        // Get user details
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Add user to team
        goal.teamMembers.push(userId);
        goal.teamProgress.push({
            userId: userId,
            userProgress: []
        });
        await goal.save();

        // Populate team members
        await goal.populate('teamMembers', 'name email phoneNumber');

        // Notify team creator via socket
        const creatorSocketId = (await User.findById(goal.creator))?.socketId;
        if (creatorSocketId) {
            io.to(creatorSocketId).emit('teamMemberJoined', {
                goalId: goal._id,
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email
                },
                totalMembers: goal.teamMembers.length
            });
        }

        res.status(200).json({
            success: true,
            message: 'Successfully joined the team',
            goal
        });
    } catch (error) {
        console.error('Join team error:', error);
        res.status(500).json({
            success: false,
            message: 'Error joining team'
        });
    }
});

// Start Team Goal
router.post('/start-team', async (req, res) => {
    try {
        const { goalId, userId } = req.body;
        const io = req.app.get('io');

        const goal = await Goal.findById(goalId);
        
        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        // Verify creator
        if (goal.creator.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the team creator can start the goal'
            });
        }

        // Check minimum team members
        if (goal.teamMembers.length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Need at least 2 team members to start'
            });
        }

        // Update goal status
        goal.status = 'active';
        goal.currentDay = 1;
        await goal.save();

        await goal.populate('teamMembers', 'name email socketId');

        // Notify all team members
        for (const member of goal.teamMembers) {
            const memberDoc = await User.findById(member._id || member);
            if (memberDoc?.socketId) {
                io.to(memberDoc.socketId).emit('teamGoalStarted', {
                    goalId: goal._id,
                    goalName: goal.goalName,
                    totalDays: goal.totalDays
                });
            }
        }

        res.status(200).json({
            success: true,
            message: 'Team goal started',
            goal
        });
    } catch (error) {
        console.error('Start team error:', error);
        res.status(500).json({
            success: false,
            message: 'Error starting team goal'
        });
    }
});

// Complete Day Progress
router.post('/day-progress', async (req, res) => {
    try {
        const { goalId, userId, task } = req.body;
        const io = req.app.get('io');

        const goal = await Goal.findById(goalId);
        
        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        if (goal.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'Goal is not active'
            });
        }

        // Check if user can complete day
        if (goal.mode === 'solo') {
            if (goal.currentDay > goal.totalDays) {
                return res.status(400).json({
                    success: false,
                    message: 'All days are already completed'
                });
            }
        }

        // Find user's progress
        const userProgressIndex = goal.teamProgress.findIndex(
            p => p.userId.toString() === userId
        );

        if (userProgressIndex === -1) {
            return res.status(403).json({
                success: false,
                message: 'You are not part of this goal'
            });
        }

        const userProgress = goal.teamProgress[userProgressIndex];

        // Check 24-hour rule
        if (userProgress.userProgress.length > 0) {
            const lastCompletion = userProgress.userProgress[userProgress.userProgress.length - 1].completedAt;
            const hoursSinceLastCompletion = (Date.now() - lastCompletion.getTime()) / (1000 * 60 * 60);
            
            if (hoursSinceLastCompletion < 24) {
                return res.status(400).json({
                    success: false,
                    message: `Please wait ${Math.ceil(24 - hoursSinceLastCompletion)} more hours before completing the next day`
                });
            }
        }

        // Add day progress
        const nextDayNumber = userProgress.userProgress.length + 1;
        const dayProgress = {
            dayNumber: nextDayNumber,
            task,
            completedAt: new Date()
        };

        userProgress.userProgress.push(dayProgress);
        goal.lastDayCompletedAt = new Date();

        // Update current day for solo mode
        if (goal.mode === 'solo') {
            goal.currentDay = nextDayNumber + 1;
        }

        // Check if goal is completed
        if (nextDayNumber >= goal.totalDays) {
            goal.status = 'completed';
            goal.completedDate = new Date();

            // Notify goal completion
            if (goal.mode === 'team') {
                for (const memberId of goal.teamMembers) {
                    const member = await User.findById(memberId);
                    if (member?.socketId) {
                        io.to(member.socketId).emit('goalCompleted', {
                            goalId: goal._id,
                            goalName: goal.goalName,
                            completedBy: userId
                        });
                    }
                }
            } else {
                const user = await User.findById(userId);
                if (user?.socketId) {
                    io.to(user.socketId).emit('goalCompleted', {
                        goalId: goal._id,
                        goalName: goal.goalName
                    });
                }
            }
        }

        await goal.save();
        await goal.populate('teamMembers', 'name email');
        await goal.populate('teamProgress.userId', 'name email');

        // Notify team members about progress update
        if (goal.mode === 'team') {
            for (const memberId of goal.teamMembers) {
                if (memberId.toString() !== userId) {
                    const member = await User.findById(memberId);
                    if (member?.socketId) {
                        io.to(member.socketId).emit('teamProgressUpdated', {
                            goalId: goal._id,
                            goal,
                            completedByUserId: userId
                        });
                    }
                }
            }
        }

        // Notify user about day unlock
        const user = await User.findById(userId);
        if (user?.socketId) {
            setTimeout(() => {
                io.to(user.socketId).emit('dayUnlocked', {
                    goalId: goal._id,
                    nextDay: nextDayNumber + 1
                });
            }, 24 * 60 * 60 * 1000);
        }

        res.status(200).json({
            success: true,
            message: 'Day completed successfully',
            goal
        });
    } catch (error) {
        console.error('Day progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Error completing day'
        });
    }
});

// Get Goal Details
router.get('/:id', async (req, res) => {
    try {
        const goal = await Goal.findById(req.params.id)
            .populate('creator', 'name email phoneNumber')
            .populate('teamMembers', 'name email phoneNumber')
            .populate('teamProgress.userId', 'name email');

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Goal not found'
            });
        }

        res.status(200).json({
            success: true,
            goal
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching goal'
        });
    }
});

// Get User's Goals
router.get('/user/:userId', async (req, res) => {
    try {
        const goals = await Goal.find({
            $or: [
                { creator: req.params.userId },
                { teamMembers: req.params.userId }
            ]
        })
        .populate('creator', 'name email')
        .populate('teamMembers', 'name email')
        .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: goals.length,
            goals
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching goals'
        });
    }
});

// Get Goal by Team Link
router.get('/team-link/:teamLink', async (req, res) => {
    try {
        const goal = await Goal.findOne({ 
            teamLink: req.params.teamLink,
            mode: 'team'
        }).populate('creator', 'name email');

        if (!goal) {
            return res.status(404).json({
                success: false,
                message: 'Invalid team link'
            });
        }

        res.status(200).json({
            success: true,
            goal: {
                _id: goal._id,
                goalName: goal.goalName,
                totalDays: goal.totalDays,
                mode: goal.mode,
                status: goal.status,
                creator: goal.creator,
                currentMembers: goal.teamMembers.length,
                maxTeamMembers: goal.maxTeamMembers
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching goal'
        });
    }
});

module.exports = router;