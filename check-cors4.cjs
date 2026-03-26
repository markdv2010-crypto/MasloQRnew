const https = require('https');
https.get('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://mobile.api.crpt.ru/mobile/check?code=0104600439931256215a%3D%3D%3D'), (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(data));
});
