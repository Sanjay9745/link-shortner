require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');

// Create Express app
const app = express();

// Middleware
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Mongoose Schema for Links
const linkSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  clicks: [
    {
      ipAddress: String,
      userAgent: String,
      location: {
        country: String,
        city: String,
        region: String,
        timezone: String,
      },
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

const Link = mongoose.model('Link', linkSchema);

// Generate a random short code
const generateShortCode = () => Math.random().toString(36).substr(2, 8);

// Route to create a new short link
app.post('/api/create', async (req, res) => {
  const { originalUrl } = req.body;

  if (!originalUrl) {
    return res.status(400).json({ error: 'Original URL is required' });
  }

  const shortCode = generateShortCode();
  const customerLink = `${process.env.BASE_URL}/link/${shortCode}`;
  const analyticsLink = `${process.env.BASE_URL}/analytics/${shortCode}`;

  const newLink = new Link({
    originalUrl,
    shortCode,
  });

  await newLink.save();

  res.json({
    message: 'Short links created successfully',
    customerLink,
    analyticsLink,
  });
});

// Route to redirect users to the original URL
app.get('/link/:shortCode', async (req, res) => {
  const { shortCode } = req.params;
  const link = await Link.findOne({ shortCode });

  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  // Get user's IP address and location
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const geo = geoip.lookup(ip);

  const clickData = {
    ipAddress: ip,
    userAgent: req.headers['user-agent'],
    location: geo
      ? {
          country: geo.country,
          city: geo.city,
          region: geo.region,
          timezone: geo.timezone,
        }
      : { country: 'Unknown', city: 'Unknown', region: 'Unknown', timezone: 'Unknown' },
  };

  // Add click data to the link's clicks array
  link.clicks.push(clickData);
  await link.save();

  // Redirect to the original URL
  res.redirect(link.originalUrl);
});

// Route to view analytics for a specific short link
app.get('/analytics/:shortCode', async (req, res) => {
  const { shortCode } = req.params;
  const link = await Link.findOne({ shortCode });

  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }

  res.json({
    originalUrl: link.originalUrl,
    shortCode: link.shortCode,
    createdAt: link.createdAt,
    totalClicks: link.clicks.length,
    clicks: link.clicks,
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});