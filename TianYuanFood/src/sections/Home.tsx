/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tab } from '../types';
import Carousel from '../components/Carousel';
import { ArrowRight, Award, ShieldCheck, Truck } from 'lucide-react';
import { motion } from 'motion/react';

interface HomeSectionProps {
  onNavigate: (tab: Tab) => void;
}

export default function HomeSection({ onNavigate }: HomeSectionProps) {
  const stats = [
    { icon: Award, label: '25年行业经验', desc: '专注调理品研发加工' },
    { icon: ShieldCheck, label: '严苛品质控管', desc: '全流程质量追踪' },
    { icon: Truck, label: '全国物流覆盖', desc: '24小时极速配送' },
  ];

  return (
    <div className="flex flex-col">
      <Carousel />

      {/* Intro Section */}
      <section className="py-20 lg:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="space-y-8"
            >
              <div>
                <h3 className="text-emerald-600 font-bold text-[10px] uppercase tracking-[0.2em] mb-3">关于田原</h3>
                <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 leading-tight text-slate-900">连接自然与餐桌的<br/><span className="text-emerald-600">美食筑梦者</span></h2>
                <p className="text-slate-500 leading-relaxed text-lg">
                  田原食品有限公司自成立以来，始终秉持“源于自然，归于品味”的核心理念。我们坐落于物产丰饶的胶东半岛，依托得天独厚的原料资源，深耕速冻调理食品加工领域二十余载。
                </p>
                <p className="text-slate-500 leading-relaxed mt-4">
                  我们不仅拥有国际一流的标准化车间和研发实验室，更建立了一套从农场直采、精细加工到冷链配送的闭环生态系统。无论是为大型餐饮连锁提供标准化的半成品定制，还是为家庭餐桌带来便捷的高品质珍馐，田原食品始终是您最信赖的伙伴。
                </p>
              </div>
              <button 
                onClick={() => onNavigate(Tab.Culture)}
                className="group inline-flex items-center space-x-2 text-emerald-700 font-bold hover:translate-x-1 transition-transform"
              >
                <span>深入了解田原文化</span>
                <ArrowRight size={20} />
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="relative rounded-3xl overflow-hidden shadow-2xl aspect-[4/3] lg:aspect-square"
            >
              <img 
                src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=happy%20Chinese%20family%20dinner%20at%20home%20warm%20atmosphere%20traditional%20Chinese%20food%20on%20table%20cozy%20interior%20family%20gathering%20Asian%20people&image_size=landscape_4_3" 
                alt="Chinese family dinner" 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-[#4A7C59]/5" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Feature Stats */}
      <section className="py-20 bg-[#F5F7F5]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
            {stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="space-y-4"
              >
                <div className="inline-flex w-16 h-16 bg-white rounded-2xl items-center justify-center text-emerald-600 shadow-sm border border-slate-100">
                  <stat.icon size={32} />
                </div>
                <h4 className="text-xl font-bold text-slate-800">{stat.label}</h4>
                <p className="text-slate-500">{stat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Product Teaser */}
      <section className="py-20 lg:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-12">
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="w-12 h-1 bg-emerald-600 mx-auto"></div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">甄选系列产品</h2>
            <p className="text-slate-500">我们为您提供多样化的调理食品选择，满足不同场景下的美食需求。</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Short list of 4 featured products */}
            {[
              { name: '锅包肉', cat: '肉禽类', img: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Chinese%20guobaorou%20crispy%20sweet%20and%20sour%20pork%20fillet%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd' },
              { name: '韩式炸鸡', cat: '肉禽类', img: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Korean%20fried%20chicken%20crispy%20golden%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd' },
              { name: '鸡米花', cat: '肉禽类', img: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=chicken%20popcorn%20crispy%20golden%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd' },
              { name: '糖醋里脊', cat: '肉禽类', img: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Chinese%20sweet%20and%20sour%20pork%20tenderloin%20food%20product%20packaging%20photography%20white%20background&image_size=square_hd' },
            ].map((p, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -10 }}
                className="group bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 p-3"
              >
                <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-5">
                  <img src={p.img} alt={p.name} className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-700" />
                </div>
                <div className="px-2 pb-5 text-left">
                  <span className="text-[10px] uppercase tracking-widest text-emerald-600 font-bold block mb-1">{p.cat}</span>
                  <h4 className="text-lg font-extrabold text-slate-800 tracking-tight">{p.name}</h4>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="pt-8">
            <button 
              onClick={() => onNavigate(Tab.Products)}
              className="px-12 py-4 bg-emerald-600 text-white rounded-full font-bold hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 transition-all active:scale-95"
            >
              查看全部产品
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
