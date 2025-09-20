const f = require('session-file-store');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ObjectId } = require('mongodb');

module.exports = function (server) {
    const io = require('socket.io')(server, {
        transports: ['websocket']
    });

    // DB 연결
    let database = null;
    async function connectDB() {
        try {
            const client = new MongoClient('mongodb://localhost:27017');
            await client.connect();
            database = client.db('omok-20');
            console.log('게임 서버 DB 연결 성공');
        } catch (error) {
            console.error('게임 서버 DB 연결 실패:', error);
        }
    }

    // 서버 시작 시 DB 연결
    connectDB();

    // 방 정보
    var matchQueue = new Map();     // grade -> [{ socketId, userId, grade, username, nickname, waitTime }]
    var userSessions = new Map();   // socketId -> { userId, grade, username, nickname }
    var socketRooms = new Map();    // 게임 진행방
    var gameRooms = new Map(); // roomId -> { players: [socket1, socket2], rematchVotes: Set(), gameInProgress: boolean }

    function findOpponentExpanded(myGrade, maxDiff) {
        for (let diff = 1; diff <= maxDiff; diff++) {
            // 더 높은 등급
            let queue = matchQueue.get(myGrade - diff);
            if (queue && queue.length > 0) {
                return queue.shift();
            }

            // 더 낮은 등급
            queue = matchQueue.get(myGrade + diff);
            if (queue && queue.length > 0) {
                return queue.shift();
            }
        }
        return null;
    }

    function createGameRoom(socket1, player2Info) {
        const roomId = uuidv4();
        const socket2 = io.sockets.sockets.get(player2Info.socketId);

        if (!socket1 || !socket2) {
            console.error('소켓이 존재하지 않습니다.');
            return;
        }

        // 방 입장
        socket1.join(roomId);
        socket2.join(roomId);

        gameRooms.set(roomId, {
            players: [socket1.id, socket2.id],
            rematchVotes: new Set(),
            gameInProgress: true,
            player1: userSessions.get(socket1.id),
            player2: userSessions.get(socket2.id)
        });

        // 방 정보 저장
        socketRooms.set(socket1.id, roomId);
        socketRooms.set(socket2.id, roomId);


        // 플레이어 1 정보
        const player1 = userSessions.get(socket1.id);
        // 플레이어 2 정보
        const player2 = userSessions.get(socket2.id);

        // 서버에서 랜덤으로 선공 결정
        const isPlayer1First = Math.random() < 0.5;

        // 매칭 성공 알림
        socket1.emit('matchFound', {
            roomId,
            userId: player2.userId,
            username: player2.username,
            nickname: player2.nickname,
            grade: player2.grade,
            profileImage: player2.profileImage,
            isPlayer1First: isPlayer1First
        });


        socket2.emit('matchFound', {
            roomId,
            userId: player1.userId,
            username: player1.username,
            nickname: player1.nickname,
            grade: player1.grade,
            profileImage: player1.profileImage,
            isPlayer1First: !isPlayer1First
        });

        console.log(`매칭 성공: ${player1.username} vs ${player2.username} (방: ${roomId})`);
    }

    function startRematch(roomId) {
        const room = gameRooms.get(roomId);

        if (!room || room.players.length !== 2) {
            console.error('리매치 시작 실패: 방 정보 오류');
            return;
        }

        if (room.gameInProgress) {
            console.error(`리매치 중복 실행 방지: 방 ${roomId} 이미 게임이 진행 중입니다.`);
            return;
        }

        const socket1 = io.sockets.sockets.get(room.players[0]);
        const socket2 = io.sockets.sockets.get(room.players[1]);

        if (!socket1 || !socket2) {
            console.error('리매치 시작 실패: 소켓 연결 오류');
            return;
        }

        const player1 = room.player1;
        const player2 = room.player2;

        // 리매치 상태 초기화
        room.gameInProgress = true;
        room.rematchVotes.clear();

        // 선공 결정
        const isPlayer1First = Math.random() < 0.5;

        // 리매치 시작 알림
        socket1.emit('rematchStarted', {
            roomId,
            userId: player2.userId,
            username: player2.username,
            nickname: player2.nickname,
            grade: player2.grade,
            profileImage: player2.profileImage,
            isPlayer1First: isPlayer1First
        });

        socket2.emit('rematchStarted', {
            roomId,
            userId: player1.userId,
            username: player1.username,
            nickname: player1.nickname,
            grade: player1.grade,
            profileImage: player1.profileImage,
            isPlayer1First: !isPlayer1First
        });

        console.log(`리매치 시작: ${room.player1.username} vs ${room.player2.username} (방: ${roomId})`);
    }

    // 30초마다 매칭 범위 확장
    setInterval(() => {
        matchQueue.forEach((queue, grade) => {
            for (let i = queue.length - 1; i >= 0; i--) {
                const player = queue[i];
                const waitTime = Date.now() - player.waitTime;

                // 30초 이상 대기 시 범위 확장
                if (waitTime > 10000) { // 테스트용으로 10초로 설정, 실제론 30000 (30초)
                    console.log(`매칭 범위 확장 시도: ${player.username} (등급: ${grade}, 대기시간: ${waitTime}ms)`);
                    const socket1 = io.sockets.sockets.get(player.socketId);
                    if (socket1 && !player.expandedNotified) {
                        socket1.emit('matchExpanded', { message: '매칭 범위가 확장되었습니다.' });
                        player.expandedNotified = true; // 한 번만 알림
                    }

                    const opponent = findOpponentExpanded(grade, 5);
                    if (opponent) {
                        queue.splice(i, 1); // 대기열에서 제거

                        const socket2 = io.sockets.sockets.get(opponent.socketId);

                        if (socket1 && socket2) {
                            createGameRoom(socket1, opponent);
                        }
                    }
                    else if (waitTime > 20000) { // 1분 이상 대기 시 매칭 실패 처리(테스트용으로 20초로 설정)
                        console.log(`매칭 실패 처리: ${player.username} (등급: ${grade}, 대기시간: ${waitTime}ms)`);
                        if (socket1) {
                            socket1.emit('matchFailed', { message: '매칭 가능한 상대가 없습니다.' });
                        }
                        queue.splice(i, 1); // 대기열에서 제거
                    }
                }
            }
        });
    }, 5000); // 5초마다 체크

    io.on('connection', async (socket) => {
        // 서버 구현
        console.log('사용자 접속됨 : ', socket.id);

        // 인증 이벤트 대기
        socket.on('authenticate', async (username) => {
            console.log('인증 요청:', username);

            try {
                // DB에서 사용자 정보 조회
                if (database) {
                    console.log('DB 연결됨, 사용자 조회 중...');
                    const users = database.collection('users');
                    const user = await users.findOne({ username: username });

                    if (user) {
                        // 사용자 정보 저장
                        const userInfo = {
                            userId: user._id.toString(),
                            username: user.username,
                            nickname: user.nickname,
                            grade: user.grade || 18,
                            profileImage: user.profileImage || 1
                        };

                        userSessions.set(socket.id, userInfo);
                        socket.emit('userInfoLoaded', userInfo);
                        console.log(`사용자 인증 성공: ${user.username}`);
                    } else {
                        console.log('사용자를 찾을 수 없음:', username);
                        socket.emit('authFailed', { message: '사용자를 찾을 수 없습니다.' });
                    }
                } else {
                    console.log('DB가 연결되지 않았습니다.');
                    socket.emit('authFailed', { message: 'DB 연결 오류' });
                }
            } catch (error) {
                console.error('인증 실패:', error);
                socket.emit('authFailed', { message: '인증에 실패했습니다.' });
            }
        });

        // 매칭 요청
        socket.on('requestMatch', function () {
            const user = userSessions.get(socket.id);

            if (!user) {
                console.error('사용자 정보 없음:', socket.id);
                socket.emit('matchError', { message: '사용자 정보가 없습니다.' });
                return;
            }

            console.log(`매칭 요청: ${user.username} (등급: ${user.grade})`);

            // 비슷한 등급 상대 찾기
            const opponent = findOpponent(user.grade);

            if (opponent) {
                // 상대방 찾음 -> 즉시 매칭
                console.log(`즉시 매칭: ${user.username} vs ${opponent.username}`);
                createGameRoom(socket, opponent);
            } else {
                // 대기열에 추가
                console.log(`대기열 추가: ${user.username}`);
                addToQueue(socket.id, user);
                socket.emit('matchWaiting', { message: '상대방을 찾는 중...' });
            }
        });

        function findOpponent(myGrade) {
            // 같은 등급 먼저 찾기
            let queue = matchQueue.get(myGrade);
            if (queue && queue.length > 0) {
                return queue.shift(); // 가장 오래 기다린 사람
            }

            // 비슷한 등급 찾기 (±2등급)
            for (let diff = 1; diff <= 2; diff++) {
                // 더 높은 등급
                queue = matchQueue.get(myGrade - diff);
                if (queue && queue.length > 0) {
                    return queue.shift();
                }

                // 더 낮은 등급
                queue = matchQueue.get(myGrade + diff);
                if (queue && queue.length > 0) {
                    return queue.shift();
                }
            }

            return null; // 상대방 없음
        }

        function addToQueue(socketId, user) {
            if (!matchQueue.has(user.grade)) {
                matchQueue.set(user.grade, []);
            }

            matchQueue.get(user.grade).push({
                socketId,
                userId: user.userId,
                grade: user.grade,
                username: user.username,
                nickname: user.nickname,
                waitTime: Date.now(),
                expandedNotified: false
            });
        }

        socket.on('cancelMatch', function () {
            const user = userSessions.get(socket.id);
            if (!user) return;

            // 대기열에서 제거
            const queue = matchQueue.get(user.grade);
            if (queue) {
                const index = queue.findIndex(p => p.socketId === socket.id);
                if (index !== -1) {
                    queue.splice(index, 1);
                    socket.emit('matchCanceled', { message: '매칭이 취소되었습니다.' });
                }
            }
        });

        // 리매치 투표
        socket.on('requestRematch', function () {
            const roomId = socketRooms.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!room) {
                socket.emit('rematchError', { message: '방 정보를 찾을 수 없습니다.' });
                return;
            }

            if (room.gameInProgress) {
                console.log(`리매치 요청 무시: 방 ${roomId} 이미 게임 진행 중`);
                return;
            }

            if (room.rematchVotes.has(socket.id)) {
                console.log(`중복 리매치 요청 무시: ${socket.id} (방: ${roomId})`);
                return;
            }

            room.rematchVotes.add(socket.id);

            console.log(`리매치 요청: ${socket.id} (방: ${roomId})`);
            console.log(`현재 투표 수: ${room.rematchVotes.size}/2`);

            // 상대방에게 리매치 요청 알림
            socket.to(roomId).emit('rematchRequested', {
                message: '상대방이 재대국을 요청했습니다.'
            });

            // 본인에게 요청 상태 알림
            socket.emit('rematchRequestSent', { message: '재대국 요청을 보냈습니다.' });

            // 두 명 모두 리매치 동의 시
            if (room.rematchVotes.size === 2) {
                console.log(`리매치 성사: 방 ${roomId}`);
                startRematch(roomId);
            }
        })

        // 리매치 수락
        socket.on('acceptRematch', function () {
            const roomId = socketRooms.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!room) {
                socket.emit('rematchError', { message: '방 정보를 찾을 수 없습니다.' });
                return;
            }

            if (room.gameInProgress) {
                console.log(`리매치 수락 무시: 방 ${roomId} 이미 게임 진행 중`);
                return;
            }

            console.log(`리매치 수락: ${socket.id} (방: ${roomId})`);

            if (room.rematchVotes.size >= 1) {
                console.log(`리매치 성사: 방 ${roomId}`);
                startRematch(roomId);
            } else {
                console.log(`수락했지만 요청이 없음: 방 ${roomId}`);
                socket.emit('rematchError', { message: '리매치 요청이 없습니다.' });
            }
        });

        // 리매치 거절
        socket.on('rejectRematch', function () {
            const roomId = socketRooms.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!room) return;

            console.log(`리매치 거절: ${socket.id} (방: ${roomId})`);

            // 리매치 투표 초기화
            room.rematchVotes.clear();

            // 상대방에게 거절 알림
            socket.to(roomId).emit('rematchRejected', { message: '재대국이 거절되었습니다.' });
        });

        // 리매치 취소 (요청자가 취소)
        socket.on('cancelRematch', function () {
            const roomId = socketRooms.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!room) return;

            // 본인의 투표만 제거
            room.rematchVotes.delete(socket.id);

            console.log(`리매치 취소: ${socket.id} (방: ${roomId})`);

            // 상대방에게 취소 알림
            socket.to(roomId).emit('rematchCanceled', { message: '재대국 요청이 취소되었습니다.' });
        });

        socket.on('surrender', function () {
            const roomId = socketRooms.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!room) {
                socket.emit('surrenderError', { message: '방 정보를 찾을 수 없습니다.' });
                return;
            }

            if (!room.gameInProgress) {
                socket.emit('surrenderError', { message: '게임이 진행 중이 아닙니다.' });
                return;
            }

            const surrenderer = userSessions.get(socket.id);
            console.log(`항복: ${surrenderer.username} (방: ${roomId})`);

            // 게임 상태 업데이트
            room.gameInProgress = false;
            room.rematchVotes.clear();

            // 상대방에게 승리 알림
            socket.to(roomId).emit('opponentSurrender', { message: `상대방이 항복했습니다.` });

            console.log(`항복 처리 완료: ${surrenderer.username} 항복`);
        });

        socket.on('leaveRoom', function () {
            var roomId = socketRooms.get(socket.id);
            socket.leave(roomId);
            socket.emit('exitRoom', { roomId: roomId });
            socket.to(roomId).emit('opponentLeft', { roomId: roomId });
            socketRooms.delete(socket.id);
        });

        // 게임 종료 이벤트 (클라이언트에서 호출)
        socket.on('gameEnded', function () {
            const roomId = socketRooms.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!room) return;

            console.log(`게임 종료: 방 ${roomId}`);

            // 게임 진행 상태 변경
            room.gameInProgress = false;
            room.rematchVotes.clear(); // 혹시라도 남아있을 수 있는 투표 초기화
        });

        socket.on('doPlayer', function (playerInfo) {
            var roomId = socketRooms.get(socket.id);
            var blockIdx_x = playerInfo.blockIdx_x;
            var blockIdx_y = playerInfo.blockIdx_y;

            console.log(`방 ${roomId}에서 플레이어 ${socket.id}가 ${blockIdx_x}, ${blockIdx_y} 위치에 돌을 놓음`);
            socket.to(roomId).emit('doOpponent', {
                blockIdx_x: blockIdx_x,
                blockIdx_y: blockIdx_y
            });
        });

        socket.on('disconnect', function () {
            console.log('사용자 접속 해제 : ', socket.id);
            // 대기열에서 제거
            const user = userSessions.get(socket.id);
            if (user) {
                const queue = matchQueue.get(user.grade);
                if (queue) {
                    const index = queue.findIndex(p => p.socketId === socket.id);
                    if (index !== -1) {
                        queue.splice(index, 1);
                        console.log(`연결 해제로 대기열에서 제거: ${user.username}`);
                    }
                }
            }

            // 방에서 나가기
            var roomId = socketRooms.get(socket.id);
            if (roomId) {
                socket.to(roomId).emit('opponentLeft', { roomId: roomId });
            }

            // 세션 정리
            userSessions.delete(socket.id);
            socketRooms.delete(socket.id);
        });

        // 클라이언트에서 애플리케이션 종료 시 호출
        socket.on('applicationQuit', function () {
            var roomId = socketRooms.get(socket.id);
            socket.leave(roomId);
            socketRooms.delete(socket.id);
        });
    });
};