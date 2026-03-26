const https = require('https');
const url = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://mobile.api.crpt.ru/mobile/check?code=0104600439931256215a%3D%3D%3D');

function get(url) {
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      get(res.headers.location);
    } else {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log(data));
    }
  });
}
get(url);
