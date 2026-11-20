const { AI_API_KEY, AI_MODEL } = process.env;
if (!AI_API_KEY || !AI_MODEL)
  throw Error("서버 환경에 AI_API_KEY와 AI_MODEL을 설정하세요.");
const r = await fetch(
  "https://api.openai.com/v1/models/" + encodeURIComponent(AI_MODEL),
  { headers: { Authorization: "Bearer " + AI_API_KEY } },
);
if (!r.ok) throw Error("이 계정의 모델 조회에 실패했습니다. HTTP " + r.status);
console.log("계정에서 조회 가능한 모델:", (await r.json()).id);
