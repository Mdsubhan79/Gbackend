const mongoose = require('mongoose');

const dayProgressSchema = new mongoose.Schema({
    dayNumber: {
        type: Number,
        required: true
    },
    task: {
        type: String,
        required: [true, 'Task description is required'],
        trim: true,
        maxlength: [500, 'Task cannot exceed 500 characters']
    },
    completedAt: {
        type: Date,
        default: Date.now
    }
});

const teamMemberProgressSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userProgress: [dayProgressSchema]
});

const goalSchema = new mongoose.Schema({
    goalName: {
        type: String,
        required: [true, 'Goal name is required'],
        trim: true,
        maxlength: [200, 'Goal name cannot exceed 200 characters']
    },
    totalDays: {
        type: Number,
        required: [true, 'Total days is required'],
        min: [1, 'Minimum 1 day required'],
        max: [365, 'Maximum 365 days allowed']
    },
    mode: {
        type: String,
        enum: {
            values: ['solo', 'team'],
            message: 'Mode must be solo or team'
        },
        required: true
    },
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    teamMembers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    teamLink: {
        type: String,
        unique: true,
        sparse: true
    },
    maxTeamMembers: {
        type: Number,
        default: 1,
        min: 1,
        max: 10
    },
    teamProgress: [teamMemberProgressSchema],
    currentDay: {
        type: Number,
        default: 1
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'completed'],
        default: 'pending'
    },
    completedDate: {
        type: Date,
        default: null
    },
    lastDayCompletedAt: { 
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// Indexes
goalSchema.index({ creator: 1, status: 1 });

goalSchema.index({ 'teamMembers': 1 });
goalSchema.index({ status: 1 });

module.exports = mongoose.model('Goal', goalSchema);