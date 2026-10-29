import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function configHintFromRaw(raw) {
  if (!raw) return null;
  try {
    if (/^GEMINI_MODEL=.*2\.0-flash/im.test(raw)) {
      return 'config.env 中 GEMINI_MODEL 使用了已停用的 gemini-2.0-flash，请改为 gemini-2.5-flash-lite';
    }
    if (/^#\s*GEMINI_API_KEY=/m.test(raw) && !/^DEEPSEEK_VISION_API_KEY=\S+/m.test(raw)) {
      return 'config.env 中 GEMINI_API_KEY 行首有 #，请去掉 # 后保存并重启应用；或改用硅基流动 DEEPSEEK_VISION_API_KEY';
    }
    const m = raw.match(/^GEMINI_API_KEY=(.*)$/m);
    if (m && !m[1].trim() && !/^DEEPSEEK_VISION_API_KEY=\S+/m.test(raw)) {
      return 'config.env 中 GEMINI_API_KEY 为空，请填写后重启应用；或配置硅基流动 DEEPSEEK_VISION_API_KEY';
    }
    if (/^DEEPSEEK_VISION_API_KEY=\s*$/m.test(raw) || /^#\s*DEEPSEEK_VISION_API_KEY=/m.test(raw)) {
      if (!/^GEMINI_API_KEY=\S+/m.test(raw)) {
        return 'config.env 中请填写 DEEPSEEK_VISION_API_KEY（硅基流动密钥）后重启应用';
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function configEnvHint() {
  const appPath = process.env.APP_CONFIG_PATH;
  if (appPath && existsSync(appPath)) {
    try {
      const hint = configHintFromRaw(readFileSync(appPath, 'utf8'));
      if (hint) return hint;
    } catch { /* ignore */ }
  }
  const dotEnv = join(__dirname, '..', '.env');
  if (existsSync(dotEnv)) {
    try {
      const raw = readFileSync(dotEnv, 'utf8');
      if (/^#\s*DEEPSEEK_VISION_API_KEY=/m.test(raw) && !/^DEEPSEEK_VISION_API_KEY=\S+/m.test(raw)) {
        return '.env 中硅基流动 DEEPSEEK_VISION_* 被注释了，请去掉行首 # 并填入密钥后重启容器';
      }
      if (/^DEEPSEEK_VISION_API_KEY=\s*$/m.test(raw)) {
        return '.env 中 DEEPSEEK_VISION_API_KEY 为空，请填写硅基流动密钥后重启容器';
      }
      const hint = configHintFromRaw(raw);
      if (hint) return hint;
    } catch { /* ignore */ }
  }
  return '未找到 AI 配置。NAS 请编辑 /volume1/docker/family-ledger/.env 填入 DEEPSEEK_VISION_*，Mac 应用请编辑 config.env';
}

loadEnvFile(join(__dirname, '..', '.env'));
if (process.env.APP_CONFIG_PATH) loadEnvFile(process.env.APP_CONFIG_PATH);
