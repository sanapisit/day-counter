import { GlobalFonts } from "@napi-rs/canvas";
import { AppConstants } from "../constants/app";
import { Logs } from "../utils/log";

Logs.log("load Font");
GlobalFonts.registerFromPath(AppConstants.FONT_PATH, AppConstants.FONT_NAME);
