var express = require('express');
var router = express.Router();
const { ObjectId } = require('mongodb');

var StatsResponseType = {
    SUCCESS: 0,
    CANNOT_FOUND_USER: 1,
    INVALID_GAME_RESULT: 2,
    NOT_LOGGED_IN: 3
}

// points.js에서 함수 import
const { updatePointsLogic } = require('./points');

// 인증 확인 미들웨어
function requireAuth(req, res, next) {
    if (!req.session || !req.session.isAuthenticated) {
        return res.status(401).json({
            message: "로그인이 필요합니다.",
            result: StatsResponseType.NOT_LOGGED_IN
        });
    }
    next();
}

// 게임 결과 기록(승/패 업데이트)
router.post('/updateGameResult', requireAuth, async function (req, res, next) {
    try {
        // 세션에서 사용자 ID 가져오기
        var userId = req.session.userId;
        var gameResult = req.body.gameResult; // 'win' 또는 'lose'

        // 입력값 검증
        if (!gameResult || (gameResult !== 'win' && gameResult !== 'lose')) {
            return res.status(400).json({
                message: "유효한 게임 결과를 입력해주세요. ('win' 또는 'lose')",
                result: StatsResponseType.INVALID_GAME_RESULT
            });
        }

        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');

        // 유저 조회
        const currentUser = await users.findOne({ _id: new ObjectId(userId) });
        if (!currentUser) {
            return res.status(404).json({
                message: "사용자를 찾을 수 없습니다.",
                result: StatsResponseType.CANNOT_FOUND_USER
            });
        }

        // 승/패 업데이트
        var totalGames = currentUser.totalGames || 0;
        var totalWins = currentUser.totalWins || 0;
        var totalLoses = currentUser.totalLoses || 0;

        // 새로운 통계 계산
        var newTotalGames = totalGames + 1;
        var newTotalWins = gameResult === 'win' ? totalWins + 1 : totalWins;
        var newTotalLoses = gameResult === 'lose' ? totalLoses + 1 : totalLoses;
        var winRate = newTotalGames > 0 ? (newTotalWins / newTotalGames) * 100 : 0;

        const result = await users.updateOne(
            { _id: new ObjectId(userId) },
            {
                $set: {
                    totalGames: newTotalGames,
                    totalWins: newTotalWins,
                    totalLoses: newTotalLoses,
                    winRate: Math.round(winRate * 100) / 100, // 소수점 2자리까지
                    lastGameAt: new Date() // 마지막 게임 시간 기록
                }
            },
            { upsert: true }    // 값이 없다면 생성
        );

        // 포인트 업데이트 (points.js 함수 사용)
        const pointResult = await updatePointsLogic(userId, gameResult, database);

        res.status(200).json({
            message: "게임 결과 기록 성공",
            gameResult: gameResult,
            record: {
                totalGames: newTotalGames,
                totalWins: newTotalWins,
                totalLoses: newTotalLoses,
                winRate: Math.round(winRate * 100) / 100
            },
            rank: {
                points: pointResult.points,
                grade: pointResult.grade,
                gradeChanged: pointResult.gradeChanged
            }
        });
    }
    catch (err) {
        console.error("게임 결과 기록 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
})

// 사용자 기본 정보 조회
router.get('/getUserInfo', requireAuth, async function (req, res, next) {
    try {
        // 세션에서 사용자 ID 가져오기
        var userId = req.session.userId;
        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');
        // 유저 조회
        const user = await users.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({
                message: "사용자를 찾을 수 없습니다.",
                result: StatsResponseType.CANNOT_FOUND_USER
            });
        }
        res.status(200).json({
            id: user._id.toString(),
            username: user.username,
            nickname: user.nickname,
            profileImage: user.profileImage || 0,
            grade: user.grade || 18,
        });
    }
    catch (err) {
        console.error("사용자 정보 조회 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
});

// 사용자 전적 조회
router.get('/getRecord', requireAuth, async function (req, res, next) {
    try {
        // 세션에서 사용자 ID 가져오기
        var userId = req.session.userId;
        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');
        // 유저 조회
        const user = await users.findOne({ _id: new ObjectId(userId) });
        if (!user) {
            return res.status(404).json({
                message: "사용자를 찾을 수 없습니다.",
                result: StatsResponseType.CANNOT_FOUND_USER
            });
        }
        res.status(200).json({
            identity: {
                id: user._id.toString(),
                username: user.username,
                nickname: user.nickname,
            },
            record: {
                totalGames: user.totalGames || 0,
                totalWins: user.totalWins || 0,
                totalLoses: user.totalLoses || 0,
                winRate: user.winRate || 0,
            }
        });
    }
    catch (err) {
        console.error("사용자 통계 조회 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
});

// 전체 유저 랭킹 조회 (승률 기준)
router.get('/ranking', async function (req, res, next) {
    try {
        var database = req.app.get('database');
        var users = database.collection('users');

        const ranking = await users.find({})
            .sort({ grade: 1, winRate: -1, totalWins: -1 }) // 등급 오름차순, 승률 내림차순, 승리 수 내림차순
            .limit(100) // 상위 100명
            .project({
                username: 1,
                nickname: 1,
                totalGames: 1,
                totalWins: 1,
                totalLoses: 1,
                winRate: 1,
                grade: 1,
                profileImage: 1
            })
            .toArray();

        res.json({
            ranking: ranking.map((user, index) => ({
                rank: index + 1,
                identity: {
                    id: user._id.toString(),
                    username: user.username,
                    nickname: user.nickname,
                },
                grade: user.grade || 18,
                profileImage: user.profileImage || 0,
                record: {
                    totalGames: user.totalGames || 0,
                    totalWins: user.totalWins || 0,
                    totalLoses: user.totalLoses || 0,
                    winRate: user.winRate || 0
                }
            }))
        });
    }
    catch (err) {
        console.error("랭킹 조회 중 오류 발생:", err);
        res.status(500).json({ message: "서버 오류" });
    }
});

module.exports = router;