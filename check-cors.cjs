const https = require('https');
https.get('https://mobile.api.crpt.ru/mobile/check?code=0104600439931256215a%3D%3D%3D', (res) => {
  console.log(res.headers);
});
