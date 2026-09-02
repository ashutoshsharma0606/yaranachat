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

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ashutoshsharma61667_db_user:xYqRjAazUbNblPLk@cluster0.nu1vila.mongodb.net/yaranachat?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas Database'))
  .catch(err => console.error('MongoDB connection error:', err));

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  recipient: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true }
});
const User = mongoose.model('User', userSchema);

// API: Search Users (Ensures case-insensitive search and fallback)
app.get('/api/users/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    const users = await User.find({
      email: { $regex: query, $options: 'i' }
    }).limit(10);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// API: Fetch Message History
app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const history = await Message.find({
      $or: [
        { sender: user1, recipient: user2 },
        { sender: user2, recipient: user1 }
      ]
    }).sort({ timestamp: 1 });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// API: Feedback endpoint
app.post('/api/feedback', (req, res) => {
  console.log('Feedback received:', req.body);
  res.json({ success: true });
});

io.on('connection', (socket) => {
  socket.on('join_room', async (userData) => {
    try {
      if (typeof userData === 'object' && userData._id) {
        socket.join(userData._id);
        await User.findOneAndUpdate(
          { _id: userData._id },
          { name: userData.name, email: userData.email },
          { upsert: true, new: true }
        );
      }
    } catch (err) {
      console.error('Error joining room/saving user:', err);
    }
  });

  socket.on('send_message', async (data) => {
    try {
      const newMessage = new Message({
        sender: data.sender,
        recipient: data.recipient,
        text: data.text
      });
      await newMessage.save();

      io.to(data.recipient).emit('receive_message', newMessage);
      io.to(data.sender).emit('receive_message', newMessage);
    } catch (err) {
      console.error('Error saving/sending message:', err);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`YaranaChat server running on port ${PORT}`);
});