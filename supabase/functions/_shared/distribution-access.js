export class DistributionAccessError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "DistributionAccessError";
    this.code = code;
    this.status = status;
  }
}

export async function resolveDistribution(p, command) {
  try {
    // The database checks both class membership and assignment using the signed-in user.
    return await command("math_library", "resolve", p);
  } catch (error) {
    if (error.code === "P0001" && error.message === "denied")
      throw new DistributionAccessError(
        "distribution_access_denied",
        "접근할 수 없습니다. 이 QR은 해당 학급에 배정된 학생만 이용할 수 있습니다. 본인 학급에 배포된 QR을 이용해 주세요.",
        403,
      );
    if (error.code === "P0002" || error.code === "22P02")
      throw new DistributionAccessError(
        "distribution_link_unavailable",
        "사용할 수 없는 QR입니다. 링크가 중지·취소되었거나 변경되었습니다. 선생님께 새 QR을 확인해 주세요.",
        404,
      );
    throw error;
  }
}
