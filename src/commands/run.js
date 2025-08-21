import "dotenv/config.js";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { runCommand } from "../utils/util.js";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const exitWithError = (message) => {
  console.error(`${message}`);
  process.exit(1);
};

async function ensureClientInstalled() {
  try {
    require.resolve("snap-bug-client/package.json", {
      paths: [path.resolve(__dirname, "../../node_modules")],
    });

    return;
  } catch {
    console.log("snap-bug-client가 설치되지 않았습니다. 자동 설치를 진행합니다...");

    try {
      await runCommand("npm", ["install", "snap-bug-client"], {
        cwd: path.resolve(__dirname, "../../"),
      });
    } catch (err) {
      exitWithError(`snap-bug-client 설치 실패: ${err.message}`);
    }
  }
}

export async function run({ deploy }) {
  await ensureClientInstalled();

  let clientPath;
  try {
    const cliNodeModules = path.resolve(__dirname, "../../node_modules");
    const resolved = require.resolve("snap-bug-client/package.json", {
      paths: [cliNodeModules],
    });

    clientPath = path.dirname(resolved);
  } catch {
    exitWithError("snap-bug-client 패키지 경로를 찾을 수 없습니다.");
  }

  const packageJsonPath = path.join(clientPath, "package.json");
  const viteConfigPath = path.join(clientPath, "vite.config.js");
  const distPath = path.join(clientPath, "dist");
  const localStatePath = path.resolve(__dirname, "../../public/snapbug-state.json");
  const distStatePath = path.join(distPath, "snapbug-state.json");

  let hasBuildScript = false;
  let isVite = false;

  try {
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    hasBuildScript = !!packageJson.scripts?.build;
  } catch {
    exitWithError("snap-bug-client의 package.json을 읽을 수 없습니다.");
  }

  if (!hasBuildScript) {
    exitWithError("snap-bug-client에 'build' 스크립트가 정의되어 있지 않습니다.");
  }

  if (existsSync(viteConfigPath)) isVite = true;

  if (isVite) {
    const vitePath = path.join(clientPath, "node_modules", ".bin", "vite");

    if (!existsSync(vitePath) || !existsSync(path.join(distPath, "index.html"))) {
      console.warn("Vite 프로젝트로 감지되어 자동 빌드를 시도합니다.");

      try {
        await runCommand("npm", ["install"], { cwd: clientPath });
        await runCommand("npm", ["run", "build"], { cwd: clientPath });
        console.log("Vite 빌드 완료!");
      } catch (err) {
        exitWithError(`Vite 자동 빌드 실패: ${err.message}`);
      }
    }
  }

  const isBuilt = existsSync(distPath) && existsSync(path.join(distPath, "index.html"));

  if (!isBuilt) {
    console.log("⚠️ 디버깅 UI 빌드가 완료되지 않았습니다.");
    console.log(
      "아래 명령어 중 본인 프로젝트 환경에 맞는 명령어를 수동으로 실행한 뒤 다시 시도해주세요.\n"
    );

    if (!isVite) {
      console.log(`[CRA 기반 예시]`);
      console.log(`cd ${clientPath}`);
      console.log(`npm install`);
      console.log(`npm run build\n`);
      console.log(`[Webpack 수동 설정 예시]`);
      console.log(`cd ${clientPath}`);
      console.log(`npm install`);
      console.log(`npx webpack --config webpack.config.js\n`);
    }

    exitWithError("빌드 완료 후 다시 'snapbug run' 명령어를 실행해주세요.");
  }

  if (!existsSync(localStatePath)) {
    exitWithError(
      "상태 추적 데이터(snapbug-state.json)가 없습니다. 먼저 상태 기록을 실행해주세요."
    );
  }

  try {
    await fs.copyFile(localStatePath, distStatePath);
    console.log("상태 JSON 복사 완료:", distStatePath);
  } catch (err) {
    exitWithError(`상태 JSON 복사 실패: ${err.message}`);
  }

  if (deploy) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) exitWithError("VERCEL_TOKEN 환경변수가 필요합니다.");

    try {
      console.log("Vercel 배포 중...");

      const result = await runCommand(
        "npx",
        ["vercel", "deploy", "--prod", "--yes", `--token=${token}`],
        { cwd: distPath }
      );

      const match = result.match(/https:\/\/.*\.vercel\.app/);
      const url = match?.[0];
      if (!url) throw new Error("배포 URL을 찾을 수 없습니다.");

      console.log(`🎉 배포 완료: ${url}`);
    } catch (err) {
      exitWithError(`배포 실패: ${err.message}`);
    }
  }
}
