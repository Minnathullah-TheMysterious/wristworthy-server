import { hashPassword } from "../helpers/authHelper.js";
import userModel from "../models/userModel.js";
import JWT from "jsonwebtoken";
import twilio from "twilio";
import speakeasy from "speakeasy";
import { sanitizeUser } from "./../helpers/authHelper.js";

// ***************Register || POST**************/
export const registerController = async (req, res) => {
  try {
    const { user_name, email, password, phone, confirm_password } = req.body;
    //validation
    if (!user_name) {
      return res.status(400).json({
        success: false,
        message: "Please Provide Your Name",
      });
    }
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Please Provide Your Email",
      });
    }
    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Please Create Your Password",
      });
    }
    if (password.length < 5) {
      return res.status(400).json({
        success: false,
        message: "Password Must be of 5 Characters Long",
      });
    }
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Please Provide Your Phone Number",
      });
    }
    if (!confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Please Confirm Your Password",
      });
    }

    //Match the password and confirm_password weather they are identical or not
    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords does not match",
      });
    }

    //find weather the user already exists with the given emil or not
    const existingUserWithEmail = await userModel.findOne({ email });

    //find weather the user already exists with the given phone number or not
    const existingUserWithPhone = await userModel.findOne({ phone });

    if (existingUserWithEmail) {
      return res.status(409).json({
        success: false,
        message: "Email is already registered, Please Login",
      });
    } else if (existingUserWithPhone) {
      return res.status(409).json({
        success: false,
        message: "Phone number is already registered. Please login",
      });
    } else {
      //Hash the password
      const hashedPassword = await hashPassword(password);
      const data = new userModel({
        user_name,
        email,
        password: hashedPassword,
        phone,
      });
      const user = await data.save();

      req.login(sanitizeUser(user), function (err) {
        //Calls the serializer and adds to it
        if (err) {
          return res.status(400).json({
            success: false,
            message: err.message || err,
          });
        }
        const token = JWT.sign(sanitizeUser(user), process.env.JWT_SECRET_KEY, {
          expiresIn: "7d",
        });

        return res
          .cookie("jwt", token, {
            expires: new Date(Date.now() + 3600000),
            httpOnly: true,
          })
          .status(201)
          .json({
            success: true,
            message: "User Registered Successfully",
            token,
          });
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something Went Wrong While Registering",
      error: error.message,
    });
    console.error("Something Went Wrong While Registering".bgRed.white, error);
  }
};

//*************Login || POST***************** */
export const loginController = async (req, res) => {
  const token = JWT.sign(sanitizeUser(req.user), process.env.JWT_SECRET_KEY, {
    expiresIn: "7d",
  });
  res
    .cookie("jwt", token, {
      expires: new Date(Date.now() + 3600000),
      httpOnly: true,
    })
    .status(200)
    .json({
      success: true,
      message: "User Logged In successfully",
      token,
      user:sanitizeUser(req.user)
    });
};

/***************Request Reset Password*********** */
export const reqResetPasswordController = async (req, res) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

  try {
    const { phone } = req.body;
    console.log("User Validation start for password reset");
    //Validation
    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number is required" });
    }

    console.log(`User Validation Done`);

    //Checking for user with the given phone number
    const user = await userModel.findOne({ phone });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    } else {
      console.log(`User Found`);

      // Generate OTP using the secret for the user
      const token = speakeasy.totp({
        secret: user.otpSecret,
        encoding: "base32",
      });

      console.log(`OTP Generated`);

      // Create a Twilio client instance
      const twilioClient = twilio(accountSid, authToken);

      console.log(`Twilio Account Created`);

      // Send OTP via SMS
      await twilioClient.messages
        .create({
          body: `Your OTP for password reset: ${token}`,
          from: twilioPhoneNumber,
          to: user.phone,
        })
        .then(() => {
          console.log(`OTP sent to client Successfully`);
          res.status(200).json({
            success: true,
            message: "OTP sent successfully",
            user_id: user?._id,
          });
        })
        .catch((error) => {
          console.error("Error sending OTP:".bgRed.white, error);
          return res
            .status(500)
            .json({ success: false, message: "Failed To Send OTP", error });
        });
    }
  } catch (error) {
    console.error(
      "Something Went Wrong in passwordResetController".bgRed.white,
      error
    );
    res.status(500).json({
      success: false,
      message: "Something Went Wrong in Resetting the Password",
      error,
    });
  }
};

/****************Verify OTP || POST******** */
export const verifyOtpController = async (req, res) => {
  try {
    const { userId } = req.params;
    const { otp } = req.body;

    //validation
    switch (true) {
      case !otp:
        return res
          .status(400)
          .json({ success: false, message: "OTP is required" });
    }

    const user = await userModel.findOne({ _id: userId });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    } else {
      // Verify OTP using the secret for the user
      const isValidOTP = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: "base32",
        token: otp,
        window: 1,
      });
      if (!isValidOTP) {
        return res.status(401).json({ success: false, message: "Invalid OTP" });
      } else {
        return res.status(200).json({ success: true, message: "OTP Verified" });
      }
    }
  } catch (error) {
    console.error(
      "Something Went Wrong in verifyOtpController".bgRed.white,
      error
    );
    res.status(500).json({
      success: false,
      message: "Something Went Wrong While verifying the OTP",
      error,
    });
  }
};

/*****************Reset Password || POST************* */
export const resetPasswordController = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log("User Id:", userId);
    const { newPassword, confirmNewPassword } = req.body;
    console.log(
      "Password:",
      newPassword,
      "\n confirm password:",
      confirmNewPassword
    );

    //Validation
    switch (true) {
      case !newPassword:
        return res
          .status(400)
          .json({ success: false, message: "New Password Is Required" });
      case !confirmNewPassword:
        return res.status(400).json({
          success: false,
          message: "Please Confirm Your Password",
        });
      default:
        break;
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User Not Found" });
    } else {
      if (newPassword !== confirmNewPassword) {
        return res
          .status(400)
          .json({ success: false, message: "Passwords Does Not Match" });
      } else {
        console.log("Entered Into Hashing and password reset section");
        const hashedPassword = await hashPassword(newPassword);
        console.log("Password Hashed Successfully", hashedPassword);
        const updatedUser = await userModel.findByIdAndUpdate(
          { _id: userId },
          { $set: { password: hashedPassword } }
        );
        console.log("Updated User:", updatedUser);
        res.status(202).json({
          success: true,
          message: "Password Reset Successful",
          updatedUser,
        });
      }
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Something Went Wrong in Resetting The Password",
    });
    console.error("Something Went Wrong in resetPasswordController", error);
  }
};

/*****************Logout || POST************* */
export const logoutController = (req, res) => {
  req.logout(() => {
    return res.json({ success: true, message: "user logged out successfully" });
  });
};
