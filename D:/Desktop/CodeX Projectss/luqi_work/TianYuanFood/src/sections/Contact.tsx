/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, Globe, MessageSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import AmapMap from '../components/AmapMap';

export default function ContactSection() {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    interest: '个人代理洽谈',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [showQRModal, setShowQRModal] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitMessage('');

    // 使用 Vercel Serverless Function 处理表单
    fetch('/api/send-email', {
      method: 'POST',
      body: JSON.stringify(formData),
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        setSubmitMessage(data.message);
        setFormData({ name: '', phone: '', interest: '个人代理洽谈', message: '' });
      })
      .catch((error) => {
        setSubmitMessage('发送失败，请稍后重试。');
        console.error('Form submission error:', error);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };
  return (
    <div className="flex flex-col pb-24">
      <div className="h-[30vh] bg-emerald-950 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-emerald-400 opacity-20" />
        <div 
          className="absolute inset-0 opacity-40 bg-cover bg-center grayscale"
          style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2000&auto=format&fit=crop)' }}
        />
        <div className="relative text-center text-white px-4 space-y-2">
          <div className="w-12 h-1.5 bg-emerald-400 mx-auto rounded-full"></div>
          <h1 className="text-5xl font-extrabold tracking-tight">联系我们</h1>
          <p className="text-emerald-100/60 font-light text-lg">期待与您的每一次沟通，共同开启美味航程。</p>
        </div>
      </div>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -translate-y-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Contact Details */}
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-white p-10 rounded-[2.5rem] shadow-xl shadow-emerald-950/5 border border-slate-100 flex flex-col space-y-8">
              <h3 className="text-2xl font-bold mb-4 text-slate-800">总部机构</h3>
              
              <div className="space-y-6">
                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0">
                    <Phone size={24} />
                  </div>
                  <div>
                    <h5 className="font-bold text-[10px] text-slate-400 uppercase tracking-[0.2em] mb-1">服务热线</h5>
                    <p className="text-lg font-bold text-slate-800">0531-8888 8888</p>
                    <p className="text-sm text-slate-400 font-light">周一至周日 09:00 - 18:00</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0">
                    <Mail size={24} />
                  </div>
                  <div>
                    <h5 className="font-bold text-[10px] text-slate-400 uppercase tracking-[0.2em] mb-1">商务洽谈</h5>
                    <p className="text-lg font-bold text-slate-800">biz@tianyuanfood.com</p>
                  </div>
                </div>

                <div className="flex items-start space-x-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shrink-0">
                    <MapPin size={24} />
                  </div>
                  <div>
                    <h5 className="font-bold text-[10px] text-slate-400 uppercase tracking-[0.2em] mb-1">公司地址</h5>
                    <p className="text-base font-bold leading-snug text-slate-800">山东省潍坊市高密市柴沟镇土庄社区驻地田原食品有限公司</p>
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-gray-100">
                <div className="flex items-center space-x-4">
                  <button 
                    onClick={() => setShowQRModal(true)}
                    className="p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <img 
                      src="/wechat_qr.png" 
                      alt="微信公众号" 
                      className="w-10 h-10 opacity-70"
                    />
                  </button>
                  <div className="text-sm">
                    <p className="font-bold">官方微信公众号</p>
                    <p className="text-gray-400">点击放大扫码</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Map & Form */}
          <div className="lg:col-span-2 space-y-8">
            {/* Form */}
            <div className="bg-white p-10 rounded-[2.5rem] shadow-xl shadow-emerald-950/5 border border-slate-100">
              <h3 className="text-2xl font-bold mb-8 flex items-center space-x-3 text-slate-800">
                <MessageSquare className="text-emerald-600" />
                <span>在线留言</span>
              </h3>
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">您的姓名</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-emerald-600/10 transition-all outline-none"
                    placeholder="输入姓名"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">联系电话</label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-emerald-600/10 transition-all outline-none"
                    placeholder="输入电话号码"
                    required
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">您的意向</label>
                  <select
                    name="interest"
                    value={formData.interest}
                    onChange={handleChange}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-emerald-600/10 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option>个人代理洽谈</option>
                    <option>餐饮连锁集采</option>
                    <option>OEM/ODM 定制</option>
                    <option>加入我们</option>
                    <option>其他</option>
                  </select>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-2">留言内容</label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    rows={4}
                    className="w-full bg-slate-50 border border-slate-100 rounded-3xl px-6 py-4 focus:ring-2 focus:ring-emerald-600/10 transition-all outline-none resize-none"
                    placeholder="请在这里描述您的问题或需求..."
                    required
                  ></textarea>
                </div>
                <div className="md:col-span-2 pt-4 space-y-4">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full md:w-auto px-16 py-4 bg-emerald-600 text-white rounded-full font-bold hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? '发送中...' : '提交需求'}
                  </button>
                  {submitMessage && (
                    <div className={`text-sm font-medium whitespace-pre-line ${submitMessage.includes('成功') ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {submitMessage}
                    </div>
                  )}
                </div>
              </form>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl shadow-emerald-950/5 border border-slate-100 overflow-hidden h-[400px]">
              <AmapMap />
            </div>
          </div>
        </div>
      </section>

      {/* QR Code Modal */}
      <AnimatePresence>
        {showQRModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowQRModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-8 shadow-2xl max-w-md w-full"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-800">微信公众号</h3>
                <button 
                  onClick={() => setShowQRModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>
              <div className="flex justify-center">
                <img 
                  src="/wechat_qr.png" 
                  alt="微信公众号" 
                  className="w-64 h-64"
                />
              </div>
              <p className="text-center text-gray-500 mt-4 text-sm">请使用微信扫码关注</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
