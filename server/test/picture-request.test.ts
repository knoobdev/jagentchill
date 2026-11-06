import assert from "node:assert/strict";
import { test } from "node:test";
import { isPictureRequest, isWholePrompt } from "../src/local-models/picture-request.ts";

test("Pictures on: every message is a picture unless it is plainly about something else", () => {
  for (const said of [
    "Tạo cho tôi một tấm hình theo prompt này: \"I am a 20-year-old Asian woman named Ha\"",
    "tao anh co gai mac vay do tren bai bien",
    "Cho ảnh ngang sexy hơn đi",
    "Vẽ một con mèo cam",
    "make a picture of a cabin in the snow",
    "a red kite over the sea at dawn, photorealistic",
    "Xoá tấm này đi, nó phải gợi cảm hơn, làm lại",
    "I am a 20-year-old Asian woman named Ha, and I work as a developer with five years of experience. I am sitting in an office chair, working on my laptop and pondering a difficult bug; on my desk, there is a cup of coffee and a roll of paper.",
    "Tạo cho tôi một tấm hình theo prompt này: \"a woman at her desk\" Và thêm vào đó là 1 tay gõ phím 1 tay cầm cốc",
    "猫の画像を作って",
    "làm lại",
  ]) assert.equal(isPictureRequest(said), true, said);
  for (const said of [
    "Đặt ảnh lên timeline ở giây thứ 2",
    "cắt clip đầu tiên còn 3 giây",
    "Thêm chữ Xin chào ở giữa",
    "put the image on the timeline",
    "export the video",
    "Xoá ảnh đầu tiên",
    "/compact",
    "tới đâu rồi?",
    "ok nhé",
    "cảm ơn",
    "Dùng tool imagegen",
    "Làm thành một video có một chút khiêu gợi đi",
    "Ê nhầm à, ý tôi là làm cái tấm hình này thành video có chuyển động nhân vật đó ấy",
    "make this picture into a video where she moves",
    "làm một bộ phim ngắn từ ảnh này",
    "lam phim tu anh nay",
    "この画像を動画にして",
    "thêm nhạc nền vui vẻ",
  ]) assert.equal(isPictureRequest(said), false, said);
});

test("A whole prompt (quoted or long) is not a change of the last picture", () => {
  assert.equal(isWholePrompt("Tạo ảnh theo prompt này: \"a woman\""), true);
  assert.equal(isWholePrompt("Cho ảnh sexy hơn"), false);
});
