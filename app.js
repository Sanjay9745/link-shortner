require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');

// Create Express app
const app = express();

// Enable trust proxy to get real IP when behind a proxy
app.set('trust proxy', true);

// Middleware
app.use(express.json());

// Function to get real IP address
const getIpAddress = (req) => {
  // Try getting IP from various headers and fallback mechanisms
  return req.headers['x-forwarded-for']?.split(',')[0]
    || req.headers['x-real-ip']
    || req.connection.remoteAddress
    || req.socket.remoteAddress
    || req.ip
    || '127.0.0.1';
};

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(`${process.env.MONGO_URI}`, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};
connectDB();

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
      geo: Object,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});
const Link = mongoose.model('Link', linkSchema);

// Generate a random short code
const generateShortCode = () => Math.random().toString(36).substr(2, 8);

// Serve static files
app.use(express.static('public'));

// Serve the HTML file at the root route
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

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
  const ip = getIpAddress(req);
  const geo = geoip.lookup(ip === '::1' ? '127.0.0.1' : ip); // Handle localhost IPv6

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
    geo: geo,
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
    return res.status(404).send('<h1>Link not found</h1>');
  }

  // Serve the analytics HTML page
  res.sendFile(__dirname + '/public/analytics.html');
});

// API endpoint to fetch analytics data
app.get('/api/analytics/:shortCode', async (req, res) => {
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