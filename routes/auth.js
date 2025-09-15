var express = require('express');
var router = express.Router();
var bcrypt = require('bcrypt');
var saltRounds = 10;
const { ObjectId } = require('mongodb');


var AuthResponseType = {
    SUCCESS: 0,
    INVALID_USERNAME: 1,
    INVALID_PASSWORD: 2,
    DUPLICATED_USERNAME: 3,
    NOT_LOGGED_IN: 4
}

// 회원가입
router.post('/signup', async function (req, res, next) {
    try {
        var username = req.body.username;
        var password = req.body.password;
        var nickname = req.body.nickname;
        var profileImage = req.body.profileImage;

        // 입력값 검증
        if (!username || !password || !nickname) {
            return res.status(400).json({ message: "모든 필드를 입력해주세요." });
        }

        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');

        // 사용자 중복 체크
        const existingUser = await users.findOne({ username: username });
        if (existingUser) {
            return res.status(409).json({
                message: "이미 존재하는 사용자 입니다.",
                result: AuthResponseType.DUPLICATED_USERNAME
            });
        }

        // 비밀번호 암호화
        var salt = bcrypt.genSaltSync(saltRounds);
        var hash = bcrypt.hashSync(password, salt);

        // DB에 저장
        await users.insertOne({
            username: username,
            password: hash,
            nickname: nickname,
            profileImage: profileImage || null,
            grade: 18,      // 기본 등급
            points: 0,      // 기본 포인트
            totalGames: 0,
            totalWins: 0,
            totalLoses: 0,
            winRate: 0,
            createdAt: new Date()
        });

        res.status(201).json({
            message: "회원가입 성공",
            result: AuthResponseType.SUCCESS
        });
    }
    catch (err) {
        console.error("회원 가입 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
})

// 로그인
router.post('/signin', async function (req, res, next) {
    try {
        var username = req.body.username;
        var password = req.body.password;

        // 입력값 검증
        if (!username || !password) {
            return res.status(400).json({ message: "모든 필드를 입력해주세요." });
        }

        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');

        // 사용자 조회
        const existingUser = await users.findOne({ username: username });
        if (existingUser) {
            // 비밀번호 검증
            var compareResult = bcrypt.compareSync(password, existingUser.password);
            if (compareResult) {
                // 세션에 사용자 정보 저장
                req.session.isAuthenticated = true;
                req.session.userId = existingUser._id;
                req.session.username = existingUser.username;
                req.session.nickname = existingUser.nickname;
                res.json({ result: AuthResponseType.SUCCESS });
            }
            else {
                res.status(401).json({
                    message: "비밀번호가 일치하지 않습니다.",
                    result: AuthResponseType.INVALID_PASSWORD
                });
            }
        }
        else {
            res.status(401).json({
                message: "존재하지 않는 사용자입니다.",
                result: AuthResponseType.INVALID_USERNAME
            });
        }
    }
    catch (err) {
        console.error("로그인 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
})

// 로그아웃
router.post('/signout', function (req, res, next) {
    // 세션이 존재하고, 인증된 상태인지 확인
    if (req.session && req.session.isAuthenticated) {
        const sessionId = req.sessionID;
        console.log(`로그아웃 시도 - 세션 ID: ${sessionId}`);
        // 세션 삭제
        req.session.destroy(function (err) {
            if (err) {
                console.error("세션 삭제 중 오류:", err);

                // 파일이 없는 경우는 이미 로그아웃된 것으로 간주
                if (err.code === 'ENOENT') {
                    console.log("세션 파일이 존재하지 않음 - 이미 로그아웃된 상태");
                    return res.status(200).json({
                        message: "성공적으로 로그아웃 되었습니다.",
                        note: "세션이 이미 만료되었습니다."
                    });
                }
                return res.status(500).json({ message: "로그아웃 처리 중 오류가 발생했습니다." });
            }
            console.log(`로그아웃 완료 - 세션 ID: ${sessionId}`);
            res.status(200).json({ message: "성공적으로 로그아웃 되었습니다." });
        });
    }
    else {
        console.log("인증되지 않은 사용자의 로그아웃 시도");
        res.status(400).json({
            message: "로그인 상태가 아닙니다.",
            result: AuthResponseType.NOT_LOGGED_IN
        });
    }
})

module.exports = router;