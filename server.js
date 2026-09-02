const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/yaranachat';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define User Schema
const userSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Google sub ID
  name: { type: String, required: true },
  email: { type: String, required: true },
  picture: { type: String },
  friends: [{ type: String }],
  pendingRequests: [{ type: String }],
  sentRequests: [{ type: String }]
});
const User = mongoose.model('User', userSchema);

// Define Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Define Feedback Schema
const feedbackSchema = new mongoose.Schema({
  name: String,
  email: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

// API: Get or Create User
app.get('/api/user/:id', async (req, res) => {
  try {
    let user = await User.findById(req.params.id);
    if (!user) {
      // Fallback auto-creation if user hasn't been saved yet
      user = new User({
        _id: req.params.id,
        name: 'User',
        email: '',
        friends: [],
        pendingRequests: [],
        sentRequests: []
      });
      await user.save();
    }
    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Search Users
app.get('/api/users/search', async (req, res) => {
  try {
    const { q, currentUserId } = req.query;
    if (!q) return res.json([]);
    
    const users = await User.find({
      _id: { $ne: currentUserId },
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } }
      ]
    }).limit(10);
    
    res.json(users);
  } catch (err) {
    console.error('Error searching users:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get Messages between two users
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Submit Feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const feedback = new Feedback(req.body);
    await feedback.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving feedback:', err);
    res.status(500).json({ error: err.message });
  }
});

// Socket.io Handlers
io.on('connection', (socket) => {
  socket.on('join_room', async (userData) => {
    try {
      socket.join(userData._id);
      let user = await User.findById(userData._id);
      if (!user) {
        user = new User({
          _id: userData._id,
          name: userData.name,
          email: userData.email,
          picture: userData.picture || '',
          friends: [],
          pendingRequests: [],
          sentRequests: []
        });
        await user.save();
      }
    } catch (err) {
      console.error('Error in join_room:', err);
    }
  });

  socket.on('send_friend_request', async ({ senderId, recipientId }) => {
    try {
      await User.findByIdAndUpdate(senderId, { $addToSet: { sentRequests: recipientId } });
      await User.findByIdAndUpdate(recipientId, { $addToSet: { pendingRequests: senderId } });
      io.to(recipientId).emit('friend_request_received', { senderId });
      socket.emit('friend_request_sent', { recipientId });
    } catch (err) {
      console.error('Error sending friend request:', err);
    }
  });

  socket.on('accept_friend_request', async ({ userId, requesterId }) => {
    try {
      await User.findByIdAndUpdate(userId, {
        $pull: { pendingRequests: requesterId },
        $addToSet: { friends: requesterId }
      });
      await User.findByIdAndUpdate(requesterId, {
        $pull: { sentRequests: userId },
        $addToSet: { friends: userId }
      });
      io.to(requesterId).emit('friend_request_accepted', { friendId: userId });
      socket.emit('friend_request_accepted', { friendId: requesterId });
    } catch (err) {
      console.error('Error accepting friend request:', err);
    }
  });

  socket.on('send_message', async ({ sender, recipient, text }) => {
    try {
      const msg = new Message({ sender, recipient, text });
      await msg.save();
      io.to(recipient).emit('receive_message', msg);
      socket.emit('receive_message', msg);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});