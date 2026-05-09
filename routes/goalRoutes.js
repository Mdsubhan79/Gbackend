const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Goal = require('../models/Goal');
const User = require('../models/User');


// ======================================================
// CREATE GOAL
// ======================================================

router.post('/create', async (req, res) => {

    try {

        const {
            userId,
            goalName,
            totalDays,
            mode,
            maxTeamMembers
        } = req.body;

        const io = req.app.get('io');

        // Validate user
        const user = await User.findById(userId);

        if (!user) {

            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Base goal data
        const goalData = {

            goalName,

            totalDays,

            mode,

            creator: userId,

            status:
                mode === 'solo'
                    ? 'active'
                    : 'pending',

            currentDay: 1,

            createdAt: new Date(),

            // IMPORTANT
            // add creator as member
            teamMembers: [userId],

            // IMPORTANT
            // add creator progress
            teamProgress: [
                {
                    userId: userId,
                    userProgress: []
                }
            ]
        };

        // Team mode settings
        if (mode === 'team') {

            goalData.teamLink = uuidv4();

            goalData.maxTeamMembers =
                maxTeamMembers || 2;
        }

        // Create goal
        const goal = new Goal(goalData);

        await goal.save();

        // Populate creator
        await goal.populate(
            'creator',
            'name email phoneNumber'
        );

        // Populate members
        await goal.populate(
            'teamMembers',
            'name email phoneNumber'
        );

        // Populate progress users
        await goal.populate(
            'teamProgress.userId',
            'name email'
        );

        // Emit socket event
        if (mode === 'team') {

            io.emit('goalCreated', {

                goalId: goal._id,

                goalName: goal.goalName,

                mode: goal.mode
            });
        }

        return res.status(201).json({

            success: true,

            message: 'Goal created successfully',

            goal
        });

    } catch (error) {

        console.error('Goal creation error:', error);

        return res.status(500).json({

            success: false,

            message: 'Error creating goal',

            error:
                process.env.NODE_ENV === 'development'
                    ? error.message
                    : undefined
        });
    }
});


// ======================================================
// JOIN TEAM
// ======================================================

router.post('/join', async (req, res) => {

    try {

        const { teamLink, userId } = req.body;

        const io = req.app.get('io');

        // Find goal
        const goal = await Goal.findOne({

            teamLink,

            mode: 'team',

            status: 'pending'
        });

        if (!goal) {

            return res.status(404).json({

                success: false,

                message: 'Invalid or expired team link'
            });
        }

        // Check full
        if (
            goal.teamMembers.length >=
            goal.maxTeamMembers
        ) {

            return res.status(400).json({

                success: false,

                message: 'Team is already full'
            });
        }

        // Already joined
        const alreadyJoined =
            goal.teamMembers.some(
                member =>
                    member.toString() ===
                    userId.toString()
            );

        if (alreadyJoined) {

            return res.status(400).json({

                success: false,

                message: 'You are already a team member'
            });
        }

        // Validate user
        const user = await User.findById(userId);

        if (!user) {

            return res.status(404).json({

                success: false,

                message: 'User not found'
            });
        }

        // Add member
        goal.teamMembers.push(userId);

        // Add progress tracking
        goal.teamProgress.push({

            userId: userId,

            userProgress: []
        });

        await goal.save();

        await goal.populate(
            'teamMembers',
            'name email phoneNumber'
        );

        // Notify creator
        const creator =
            await User.findById(goal.creator);

        if (creator?.socketId) {

            io.to(creator.socketId)
                .emit('teamMemberJoined', {

                    goalId: goal._id,

                    user: {
                        _id: user._id,
                        name: user.name,
                        email: user.email
                    },

                    totalMembers:
                        goal.teamMembers.length
                });
        }

        return res.status(200).json({

            success: true,

            message: 'Successfully joined the team',

            goal
        });

    } catch (error) {

        console.error('Join team error:', error);

        return res.status(500).json({

            success: false,

            message: 'Error joining team'
        });
    }
});


// ======================================================
// START TEAM GOAL
// ======================================================

router.post('/start-team', async (req, res) => {

    try {

        const { goalId, userId } = req.body;

        const io = req.app.get('io');

        const goal =
            await Goal.findById(goalId);

        if (!goal) {

            return res.status(404).json({

                success: false,

                message: 'Goal not found'
            });
        }

        // Only creator
        if (
            goal.creator.toString() !==
            userId.toString()
        ) {

            return res.status(403).json({

                success: false,

                message:
                    'Only creator can start'
            });
        }

        // Minimum members
        if (goal.teamMembers.length < 2) {

            return res.status(400).json({

                success: false,

                message:
                    'Need at least 2 members'
            });
        }

        goal.status = 'active';

        goal.currentDay = 1;

        await goal.save();

        await goal.populate(
            'teamMembers',
            'name email socketId'
        );

        // Notify members
        for (const member of goal.teamMembers) {

            const memberDoc =
                await User.findById(
                    member._id || member
                );

            if (memberDoc?.socketId) {

                io.to(memberDoc.socketId)
                    .emit('teamGoalStarted', {

                        goalId: goal._id,

                        goalName: goal.goalName,

                        totalDays: goal.totalDays
                    });
            }
        }

        return res.status(200).json({

            success: true,

            message: 'Team goal started',

            goal
        });

    } catch (error) {

        console.error('Start team error:', error);

        return res.status(500).json({

            success: false,

            message:
                'Error starting team goal'
        });
    }
});


// ======================================================
// COMPLETE DAY
// ======================================================

router.post('/day-progress', async (req, res) => {

    try {

        const {
            goalId,
            userId,
            task
        } = req.body;

        const io = req.app.get('io');

        const goal =
            await Goal.findById(goalId);

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

        // Find user progress
        const userProgressIndex =
            goal.teamProgress.findIndex(p => {

                const progressUserId =
                    p.userId._id
                        ? p.userId._id.toString()
                        : p.userId.toString();

                return (
                    progressUserId ===
                    userId.toString()
                );
            });

        // Not member
        if (userProgressIndex === -1) {

            return res.status(403).json({

                success: false,

                message:
                    'You are not part of this goal'
            });
        }

        const userProgress =
            goal.teamProgress[userProgressIndex];

        // Safety
        if (!userProgress.userProgress) {

            userProgress.userProgress = [];
        }

        // Check 24-hour rule
        if (
            userProgress.userProgress.length > 0
        ) {

            const lastCompletion =
                userProgress.userProgress[
                    userProgress.userProgress.length - 1
                ].completedAt;

            const hours =
                (
                    Date.now() -
                    new Date(lastCompletion).getTime()
                ) /
                (1000 * 60 * 60);

            if (hours < 24) {

                return res.status(400).json({

                    success: false,

                    message:
                        `Please wait ${Math.ceil(24 - hours)} more hours`
                });
            }
        }

        // Add progress
        const nextDay =
            userProgress.userProgress.length + 1;

        userProgress.userProgress.push({

            dayNumber: nextDay,

            task,

            completedAt: new Date()
        });

        goal.currentDay = nextDay + 1;

        goal.lastDayCompletedAt =
            new Date();

        // Completed goal
        if (nextDay >= goal.totalDays) {

            goal.status = 'completed';

            goal.completedDate =
                new Date();

            // Notify users
            for (const memberId of goal.teamMembers) {

                const member =
                    await User.findById(memberId);

                if (member?.socketId) {

                    io.to(member.socketId)
                        .emit('goalCompleted', {

                            goalId: goal._id,

                            goalName: goal.goalName
                        });
                }
            }
        }

        await goal.save();

        await goal.populate(
            'teamMembers',
            'name email'
        );

        await goal.populate(
            'teamProgress.userId',
            'name email'
        );

        // Notify team
        if (goal.mode === 'team') {

            for (const memberId of goal.teamMembers) {

                if (
                    memberId.toString() !==
                    userId.toString()
                ) {

                    const member =
                        await User.findById(memberId);

                    if (member?.socketId) {

                        io.to(member.socketId)
                            .emit(
                                'teamProgressUpdated',
                                {
                                    goalId: goal._id,
                                    goal
                                }
                            );
                    }
                }
            }
        }

        return res.status(200).json({

            success: true,

            message:
                'Day completed successfully',

            goal
        });

    } catch (error) {

        console.error(
            'Day progress error:',
            error
        );

        return res.status(500).json({

            success: false,

            message:
                'Error completing day'
        });
    }
});


// ======================================================
// GET GOAL DETAILS
// ======================================================

router.get('/:id', async (req, res) => {

    try {

        const goal =
            await Goal.findById(req.params.id)

                .populate(
                    'creator',
                    'name email phoneNumber'
                )

                .populate(
                    'teamMembers',
                    'name email phoneNumber'
                )

                .populate(
                    'teamProgress.userId',
                    'name email'
                );

        if (!goal) {

            return res.status(404).json({

                success: false,

                message: 'Goal not found'
            });
        }

        return res.status(200).json({

            success: true,

            goal
        });

    } catch (error) {

        return res.status(500).json({

            success: false,

            message:
                'Error fetching goal'
        });
    }
});


// ======================================================
// GET USER GOALS
// ======================================================

router.get('/user/:userId', async (req, res) => {

    try {

        const goals = await Goal.find({

            $or: [

                { creator: req.params.userId },

                { teamMembers: req.params.userId }
            ]
        })

            .populate(
                'creator',
                'name email'
            )

            .populate(
                'teamMembers',
                'name email'
            )

            .sort({ createdAt: -1 });

        return res.status(200).json({

            success: true,

            count: goals.length,

            goals
        });

    } catch (error) {

        return res.status(500).json({

            success: false,

            message:
                'Error fetching goals'
        });
    }
});


// ======================================================
// GET TEAM LINK
// ======================================================

router.get('/team-link/:teamLink', async (req, res) => {

    try {

        const goal = await Goal.findOne({

            teamLink: req.params.teamLink,

            mode: 'team'
        })

            .populate(
                'creator',
                'name email'
            );

        if (!goal) {

            return res.status(404).json({

                success: false,

                message:
                    'Invalid team link'
            });
        }

        return res.status(200).json({

            success: true,

            goal: {

                _id: goal._id,

                goalName: goal.goalName,

                totalDays: goal.totalDays,

                mode: goal.mode,

                status: goal.status,

                creator: goal.creator,

                currentMembers:
                    goal.teamMembers.length,

                maxTeamMembers:
                    goal.maxTeamMembers
            }
        });

    } catch (error) {

        return res.status(500).json({

            success: false,

            message:
                'Error fetching team goal'
        });
    }
});


module.exports = router;