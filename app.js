var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

// DB 설정
var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

// DB에 연결
async function connectDB() {
  var databaseURL = "mongodb://localhost:27017";
  try {
    const database = await MongoClient.connect(databaseURL, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("DB 연결 완료: " + databaseURL);
    app.set('database', database.db('omok-20'));

    // 연결 종료 처리
    process.on("SIGINT", async () => {
      await database.close();
      console.log("DB 연결 종료");
      process.exit(0);
    });
  } catch (err) {
    console.error("DB 연결 실패: " + err);
    process.exit(1);
  }
}
connectDB().catch(err => {
  console.error("초기 DB 연결 실패: " + err);
  process.exit(1);
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
