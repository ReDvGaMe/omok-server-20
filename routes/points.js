var express = require('express');
var router = express.Router();
const { ObjectId } = require('mongodb');

var GradePoint = {
    1: 10, 2: 10, 3: 10, 4: 10,
    5: 5, 6: 5, 7: 5, 8: 5, 9: 5,
    10: 3, 11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3
}

var PointsResponseType = {
    SUCCESS: 0,
    CANNOT_FOUND_USER: 1,
    INVALID_GAME_RESULT: 2,
    NOT_LOGGED_IN: 3
}

// 인증 확인 미들웨어
function requireAuth(req, res, next) {
    if (!req.session || !req.session.isAuthenticated) {
        return res.status(401).json({
            message: "로그인이 필요합니다.",
            result: PointsResponseType.NOT_LOGGED_IN
        });
    }
    next();
}

async function updatePointsLogic(userId, gameResult, database) {
    const users = database.collection('users');

    const currentUser = await users.findOne({ _id: new ObjectId(userId) });
    if (!currentUser) {
        throw new Error("사용자를 찾을 수 없습니다.");
    }

    // 승패에 따른 포인트 변환
    var point = gameResult === 'win' ? 1 : -1;
    // 저장되어있던 포인트 및 등급
    var savedPoint = currentUser.points || 0;
    var savedGrade = currentUser.grade || 18;
    // 갱신 후 포인트
    var newPoint = savedPoint + point;
    var grade = savedGrade;

    // Grade 객체에서 해당 등급의 포인트 가져오기
    var gradePoints = GradePoint[grade];
    if (gradePoints === undefined) {
        throw new Error("잘못된 등급입니다.");
    }

    // 등급에 따른 최소, 최대 포인트
    var minPoint = -gradePoints;
    var maxPoint = gradePoints;

    // 등급 강등/승급 로직
    if (newPoint <= minPoint) {
        grade = Math.min(grade + 1, 18);
        newPoint = grade === 18 ? minPoint : 0;
    }
    else if (newPoint >= maxPoint) {
        grade = Math.max(grade - 1, 1);
        newPoint = grade === 1 ? maxPoint : 0;
    }

    // DB 업데이트
    await users.updateOne(
        { _id: new ObjectId(userId) },
        {
            $set: {
                points: newPoint,
                grade: grade,
                updatedPointAt: new Date()
            }
        }
    );

    return {
        pointChange: point,
        points: newPoint,
        grade: grade,
        gradeChanged: grade !== savedGrade,
        user: currentUser
    };
}

// 승급 포인트 갱신
router.post('/update', requireAuth, async function (req, res, next) {
    try {
        // 세션에서 사용자 ID 가져오기
        var userId = req.session.userId;
        // 요청에서 승패 결과 가져오기
        var gameResult = req.body.gameResult;

        // 입력값 검증
        if (!gameResult || (gameResult !== 'win' && gameResult !== 'lose')) {
            return res.status(400).json({
                message: "유효한 게임 결과를 입력해주세요. ('win' 또는 'lose')",
                result: PointsResponseType.INVALID_GAME_RESULT
            });
        }

        // DB 연결
        var database = req.app.get('database');

        // 분리된 함수 사용
        const result = await updatePointsLogic(userId, gameResult, database);

        res.status(200).json({
            message: "포인트 갱신 성공",
            rank: {
                points: result.points,
                grade: result.grade,
                gradeChanged: result.gradeChanged
            }
        });
    }
    catch (err) {
        console.error("승급 포인트 갱신 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
})

// 승급 포인트 조회
router.get('/getPoints', requireAuth, async function (req, res, next) {
    try {
        // 세션에서 사용자 ID 가져오기
        var userId = req.session.userId;

        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');

        // 유저 조회
        const user = await users.findOne({
            _id: new ObjectId(userId)
        });
        // 데이터 베이스 상에서 유저가 없다면 에러
        if (!user) {
            return res.status(404).json({
                message: "사용자를 찾을 수 없습니다.",
                result: PointsResponseType.CANNOT_FOUND_USER
            });
        }

        res.json({
            identity: {
                id: user._id.toString(),
                username: user.username,
                nickname: user.nickname,
            },
            points: user.points || 0
        });
    }
    catch (err) {
        console.error("승급 포인트 조회 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
})

// 등급 조회
router.get('/getGrade', requireAuth, async function (req, res, next) {
    try {
        // 세션에서 사용자 ID 가져오기
        var userId = req.session.userId;

        // DB 연결
        var database = req.app.get('database');
        var users = database.collection('users');

        // 유저 조회
        const user = await users.findOne({
            _id: new ObjectId(userId)
        });
        // 데이터 베이스 상에서 유저가 없다면 에러
        if (!user) {
            return res.status(404).json({
                message: "사용자를 찾을 수 없습니다.",
                result: PointsResponseType.CANNOT_FOUND_USER
            });
        }

        res.json({
            identity: {
                id: user._id.toString(),
                username: user.username,
                nickname: user.nickname,
            },
            grade: user.grade || 18
        });
    }
    catch (err) {
        console.error("등급 조회 중 오류 발생 : ", err);
        res.status(500).json({ message: "서버 오류" });
    }
})

module.exports = router;
module.exports.updatePointsLogic = updatePointsLogic; // 함수 export