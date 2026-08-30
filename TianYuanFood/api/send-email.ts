export default async function handler(req: { method: string; body: { name: string; phone: string; interest: string; message: string } }, res: { status: (arg0: number) => { (): unknown; new(): unknown; json: { (arg0: { message: string }): void; new(): unknown } } }) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { name, phone, interest, message } = req.body;

  // PushPlus 微信推送服务
  // 需要去 https://www.pushplus.plus/ 注册获取 Token
  const PUSH_PLUS_TOKEN = 'ecf538fd32724fd396827dcdf6f2a52d'; // 替换为你的 Token

  const title = '田原食品 - 新留言';
  const content = `
**姓名**: ${name}
**电话**: ${phone}
**意向**: ${interest}
**留言**: ${message}
  `.trim();

  // 发送微信通知
  if (PUSH_PLUS_TOKEN && PUSH_PLUS_TOKEN !== 'YOUR_PUSH_PLUS_TOKEN') {
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
    message: `留言已收到！\n\n姓名: ${name}\n电话: ${phone}\n意向: ${interest}\n留言: ${message}\n\n我们会尽快联系您！` 
  });
}