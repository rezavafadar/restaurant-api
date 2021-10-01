const uuid = require('uuid').v4;
const sharp = require('sharp');
const bcrypt = require('bcrypt');

const path = require('path');

const User = require('../model/user');
const filtredObj = require('../utils/filteredObj');
const sendEmail = require('../utils/email');
const {signToken,verifyToken} = require('../utils/jwt');

const createSendToken = (user, statusCode, req, res) => {
	const token = signToken({ id: user._id });

	user.password = null;

	res.status(statusCode).json({ status: 'success', token, data: user });
};

const register = async (req, res) => {
	try {
		await User.validateBody(req.body);
	} catch (err) {
		return res.status(400).json({
			message: 'Bad Request! Validation faild',
			errors: errors,
		});
	}

	// create user
	const currentUser = await User.findOne({ email: req.body.email });
	if (currentUser)
		return res
			.status(400)
			.json({ message: 'A user is available with this email' });

	const password = await bcrypt.hash(req.body.password, 9);
	console.log('register hashPass:',password);
	let user = {
		fullname: req.body.fullname,
		email: req.body.email,
		password:password,
	};

	await User.create(user);

	res.status(201).json({ message: 'User created !' });
	sendEmail(user.email,'welcome',`${user.fullname} welcome to restaurant`)
};

const login = async (req, res) => {
	const { email, password } = req.body;

	if (email && password) {
		const user = await User.findOne({ email });
		if (!user)
			return res.status(404).json({ message: 'User is not defined!' });
		console.log([password]);
		console.log([user.password]);
		const passMatch = await bcrypt.compare(password, user.password);

		console.log(passMatch);
		if (!passMatch)
			return res.status(401).json({ message: 'Unauthorized' });

		createSendToken(user, 200, req, res);
	} else {
		return res
			.status(400)
			.json({ message: 'Bad Request ! Email or password is wrong' });
	}
};

const forgetPassword = async (req, res) => {
	const { email } = req.body;
	if (!email)
		return res
			.status(400)
			.json({ message: 'Bad Request! email is required' });

	const user = await User.findOne({ email });

	if (!user) return res.status(404).json({ message: 'User is not defined' });

	const token = signToken({ id: user._id, resetPass: true });
	user.passwordResetToken = token;
	user.passwordResetExpires = Date.now() + 10 * 60 * 1000;
	await user.save();
	const url = `http://localhost:3000/api/user/resetpassword/${token}`;
	await sendEmail(user.email,'reset password',`reset password Link: ${url}`)
	res.status(200).json({ message: 'successful! Token sent to email!'});
};

const resetPassword = async (req, res) => {
	const { id } = req.params;

	let token = await verifyToken(id);
	if (!token)
		return res
			.status(400)
			.json({ message: 'Bad Request ! Token is not valid' });

	if (token.id && token.resetPass) {
		if (!req.body.password)
			return res
				.status(400)
				.json({ message: 'new password is required!' });
		const user = await User.findOne({
			passwordResetToken: id,
			passwordResetExpires: { $gt: Date.now() },
		});

		if (!user)
			return res
				.status(401)
				.json({ message: 'Token is invalid or has expired' });

		user.password = req.body.password;
		user.passwordResetToken = null;
		user.passwordResetExpires = null;
		user.passwordChangedAt = Date.now();
		await user.save();
		res.status(200).json({ message: 'successfull!' });
	} else
		return res
			.status(401)
			.json({ message: 'Bad Request ! Token is not valid' });
};

const getUser = async (req, res) => {
  const {
    fullname = '',
    email = '',
    createAt = '',
    role = '',
    active = '',
    photo = '',
  } = await User.findById(req.user._id);
  if (fullname === '')
    return res.status(404).json({ message: 'User is not defined!' });

  res.status(200).json({
    message: 'Find user is successfull!',
    data: { fullname, email, createAt, role, active, photo },
  });
};

const uploadProfileImg = async (req, res, next) => {
  if (!req.files) return next();

  const img = req.files ? req.files.profileImg : {};

  const fileName = `${uuid()}_${img.name}`;
  const uploadPath = path.join(
    __dirname,
    '..',
    'public',
    'uploadImgs',
    fileName
  );

  sharp(img.data)
    .toFormat('jpeg')
    .jpeg({ quality: 60 })
    .toFile(uploadPath)
    .catch((err) => console.log(err));

  req.profileImg = fileName;
  next();
};

const updateMe = async (req, res) => {

  const body = req.body;

  if (body.password || body.role)
    return res.status(400).json({
      message: 'Bad Request ! The request contains sensitive information',
    });

  const obj = filtredObj(body, 'fullname', 'email');

  if (req.profileImg) obj.photo = req.profileImg;

  await User.findByIdAndUpdate(req.user.id, obj);

  res.status(200).json({ message: 'Edit is successfull!' });
};

const deleteUser = async(req,res)=>{
  
  await User.findByIdAndUpdate(req.user.id,{active:false})

  res.status(200).json({'status':'success'})
};

const getAllUser = async (req,res)=>{
  if(req.user.role != 'superAdmin') return res.status(401).json({'message':'Bad request! you do not have permission to perform this action'})
  const {id} = req.params

  const users = await User.find({}).skip((id-1)*10).exec(10)

  res.status(200).json({'message':'successfull!',data:users})
}

const userAuthenticate = async (req, res, next) => {
	let token;
	if (
		req.headers.authorization &&
		req.headers.authorization.startsWith('Bearer')
	)
		token = req.headers.authorization.split(' ')[1];
	else
		return res.status(400).json({
			message: 'You are not logged in! Please log in to get access.',
		});

	const decoded = await verifyToken(token);
	if (!decoded)
		return res
			.status(400)
			.json({ message: 'Bad request! Token is not valid' });

	const currentUser = await User.findById(decoded.id);

	if (!currentUser)
		return res.status(401).json({
			message: 'The user belonging to this token does no longer exist',
		});

	if (currentUser.changedPasswordAfter(decoded.iat)) {
		return res.status(401).json({
			message: 'User recently changed password! Please log in again',
		});
	}

	req.user = currentUser;
	next();
};

module.exports={
  getUser,
  uploadProfileImg,
  updateMe,
  deleteUser,
  getAllUser,
  register,
  login,
  resetPassword,
  forgetPassword,
  userAuthenticate
}