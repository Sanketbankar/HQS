const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Route files okay
const homeRoute = require('./routes/home');
const topRoute = require('./routes/top');
const hdRoute = require('./routes/hdporn');
const brazzersRoute = require('./routes/brazzers');
const categoryRoute = require('./routes/categories/categories');
const categoryNameRoute = require('./routes/categories/categoryName');
const girlsRoute = require('./routes/girls/girls');
const actressRoute = require('./routes/girls/actress');
const searchRoute = require('./routes/search/query');
const detailRoute = require('./routes/details/video');
const studioRoute = require('./routes/studio/studio');

// ✅ Root welcome route
app.get('/', (req, res) => {
    res.send('👋 Welcome to the server!');
});

// ✅ Root welcome route
app.get('/api', (req, res) => {
    res.send('👋 Welcome to the API server!');
});

// Use routes
app.use('/api/home', homeRoute);
app.use('/api/top', topRoute);
app.use('/api/hdporn', hdRoute);
app.use('/api/free-brazzers-videos', brazzersRoute);
app.use('/api/categories', categoryRoute);
app.use('/api/category', categoryNameRoute);
app.use('/api/girls', girlsRoute);
app.use('/api/actress', actressRoute);
app.use('/api/search', searchRoute);
app.use('/api/detail/hdporn', detailRoute);
app.use('/api/studio', studioRoute);


app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
