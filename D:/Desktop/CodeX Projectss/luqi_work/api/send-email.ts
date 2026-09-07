/**
 * 田原食品子站（/tianyuanFood）留言通知函数
 * 从 TianYuanFood/api/send-email.ts 迁移到部署根目录，Vercel 自动挂载为 /api/send-email
 *
 * 安全改动：PushPlus Token 改为从环境变量读取（Vercel 项目设置中配置 PUSH_PLUS_TOKEN）
 */
export default async function handler(
  req: { method: string; body: { name: string; phone: string; interest: string; message: string } },
  res: { status: (arg0: number) => { json: (arg0: { message: string }) => void } }
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { name, phone, interest, message } = req.body;

  // PushPlus 微信推送服务，Token 在 Vercel 环境变量 PUSH_PLUS_TOKEN 中配置
  const PUSH_PLUS_TOKEN = process.env.PUSH_PLUS_TOKEN ?? '';

  const title = '田原食品 - 新留言';
  const content = `
**姓名**: ${name}
**电话**: ${phone}
**意向**: ${interest}
**留言**: ${message}
  `.trim();

  // 发送微信通知
  if (PUSH_PLUS_TOKEN) {
    try {
      await fetch('https://www.pushplus.plus/send', {
        method: 'POST',
        body: JSON.stringify({
          token: PUSH_PLUS_TOKEN,
          title: title,
          content: content,
          template: 'markdown',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.error('PushPlus error:', error);
    }
  }

  res.status(200).json({
    message: `留言已收到！\n\n姓名: ${name}\n电话: ${phone}\n意向: ${interest}\n留言: ${message}\n\n我们会尽快联系您！`,
  });
}
