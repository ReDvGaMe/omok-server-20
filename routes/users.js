var express = require('express');
var router = express.Router();

/* GET users listing. */
router.get('/', function (req, res, next) {
  res.send('respond with a resource');
});

// 다른 사용자 관련 기능들을 여기에 추가

module.exports = router;