const https = require('https');
https.get('https://api.allorigins.win/get?url=' + encodeURIComponent('https://mobile.national-catalog.ru/api/v3/product/info?gtin=04600439931256'), (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
});
