/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tab } from '../types';
import { Leaf, Phone, Mail, MapPin } from 'lucide-react';

interface FooterProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export default function Footer({ activeTab, onTabChange }: FooterProps) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-[#1D2122] text-gray-400 py-12 lg:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="space-y-6">
            <div 
              className="flex items-center space-x-2 cursor-pointer text-white"
              onClick={() => onTabChange(Tab.Home)}
            >
              <Leaf className="text-[#4A7C59]" size={28} />
              <span className="text-2xl font-bold">田原食品</span>
            </div>
            <p className="text-sm leading-relaxed">
              田原食品有限公司致力于为全球消费者提供健康、美味、安全的优质调理食品。从田间到餐桌，我们守护每一份鲜活。
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-6">
            <h4 className="text-white font-semibold">快速链接</h4>
            <ul className="space-y-4 text-sm">
              <li>
                <button onClick={() => onTabChange(Tab.Home)} className="hover:text-[#4A7C59] transition-colors">
                  首页
                </button>
              </li>
              <li>
                <button onClick={() => onTabChange(Tab.Culture)} className="hover:text-[#4A7C59] transition-colors">
                  田原文化
                </button>
              </li>
              <li>
                <button onClick={() => onTabChange(Tab.Products)} className="hover:text-[#4A7C59] transition-colors">
                  田原产品
                </button>
              </li>
              <li>
                <button onClick={() => onTabChange(Tab.Contact)} className="hover:text-[#4A7C59] transition-colors">
                  联系我们
                </button>
              </li>
            </ul>
          </div>

          {/* Contact Info */}
          <div className="space-y-6">
            <h4 className="text-white font-semibold">联系信息</h4>
            <ul className="space-y-4 text-sm">
              <li className="flex items-start space-x-3">
                <Phone size={18} className="text-[#4A7C59] shrink-0" />
                <span>服务热线：0531-8888 8888</span>
              </li>
              <li className="flex items-start space-x-3">
                <Mail size={18} className="text-[#4A7C59] shrink-0" />
                <span>电子邮箱：contact@tianyuanfood.com</span>
              </li>
              <li className="flex items-start space-x-3">
                <MapPin size={18} className="text-[#4A7C59] shrink-0" />
                <span>公司地址：山东省潍坊市高密市柴沟镇土庄社区驻地田原食品有限公司</span>
              </li>
            </ul>
          </div>

          {/* Social / Certs */}
          <div className="space-y-6">
            <h4 className="text-white font-semibold">品质保障</h4>
            <div className="flex flex-wrap gap-4">
              <div className="px-3 py-1 border border-gray-700 rounded text-xs">ISO 9001 认证</div>
              <div className="px-3 py-1 border border-gray-700 rounded text-xs">HACCP 认证</div>
              <div className="px-3 py-1 border border-gray-700 rounded text-xs">绿色食品标志</div>
            </div>
            <div className="pt-4">
              <p className="text-xs">关注我们：</p>
              <div className="flex space-x-4 mt-2">
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center hover:bg-[#4A7C59] transition-colors cursor-pointer">
                  <span className="text-[10px] font-bold">微信</span>
                </div>
                <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center hover:bg-[#4A7C59] transition-colors cursor-pointer">
                  <span className="text-[10px] font-bold">微博</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-gray-800 flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-mono">
          <p>© {currentYear} 田原食品有限公司 版权所有</p>
          <div className="flex space-x-6">
            <a href="#" className="hover:text-white transition-colors">隐私协议</a>
            <a href="#" className="hover:text-white transition-colors">鲁ICP备88888888号</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
