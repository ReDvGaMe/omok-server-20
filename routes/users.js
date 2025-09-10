var express = require('express');
var router = express.Router();
var bcrypt = require('bcrypt');
var saltRounds = 10;
const { ObjectId } = require('mongodb');

var ResponseType = {
  INVALID_USERNAME: 0,
  INVALID_PASSWORD: 1,
  SUCCESS: 2,
  DUPLICATED_USERNAME: 3,
}

/* GET users listing. */
router.get('/', function (req, res, next) {
  res.send('respond with a resource');
});

// 회원가입
router.post('/signup', async function (req, res, next) {
  try {
    var username = req.body.username;
    var password = req.body.password;
    // var nickname = req.body.nickname;

    // 입력값 검증
    if (!username || !password) {
      // if (!username || !password || !nickname) {
      return res.status(400).json({ message: "모든 필드를 입력해주세요." });
    }

    // DB 연결
    var database = req.app.get('database');
    var users = database.collection('users');

    // 사용자 중복 체크
    const existingUser = await users.findOne({ username: username });
    if (existingUser) {
      return res.status(409).json({ message: "이미 존재하는 사용자 입니다." });
    }

    // 비밀번호 암호화
    var salt = bcrypt.genSaltSync(saltRounds);
    var hash = bcrypt.hashSync(password, salt);

    // DB에 저장
    await users.insertOne({
      username: username,
      password: hash
      // nickname: nickname
    });

    res.status(201).json({ message: "회원가입 성공" });
  }
  catch (err) {
    console.error("회원 가입 중 오류 발생 : ", err);
    res.status(500).json({ message: "서버 오류" });
  }
});

module.exports = router;
