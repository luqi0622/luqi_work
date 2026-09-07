/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TIMELINE, CULTURE_IMAGE } from '../constants';
import { motion } from 'motion/react';
import { Target, Eye, Heart } from 'lucide-react';

export default function CultureSection() {
  const coreValues = [
    { icon: Target, title: '企业使命', desc: '以匠心萃取自然馈赠，让每一份调理食品都成为健康生活的加分项。' },
    { icon: Eye, title: '企业愿景', desc: '成为全球领先的调理食品供应商，引领健康、便捷、高品质的餐饮新模式。' },
    { icon: Heart, title: '企业口号', desc: '田原出品，必属精品。每一份用心，只为您的一口安心。' },
  ];

  return (
    <div className="flex flex-col pb-24">
      {/* Banner */}
      <div className="h-[40vh] relative overflow-hidden flex items-center justify-center">
        <img 
          src={CULTURE_IMAGE} 
          alt="Culture Banner" 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/60" />
        <h1 className="relative text-white text-5xl md:text-6xl font-bold tracking-tight">田原文化</h1>
      </div>

      {/* Philosophy */}
      <section className="py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {coreValues.map((value, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 text-center space-y-6"
            >
              <div className="inline-flex w-20 h-20 bg-emerald-50 rounded-full items-center justify-center text-emerald-600">
                <value.icon size={40} />
              </div>
              <h3 className="text-2xl font-bold text-slate-800">{value.title}</h3>
              <p className="text-slate-500 leading-relaxed">{value.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="py-24 bg-emerald-950 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20">
          <div className="text-center space-y-4">
            <div className="w-12 h-1 bg-emerald-400 mx-auto"></div>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">奋斗足迹</h2>
            <p className="text-emerald-100/60">二十五年来，我们一步一个脚印，见证了田原的成长与蜕变。</p>
          </div>

          <div className="relative border-l border-emerald-400/20 ml-4 md:ml-0 md:left-1/2">
            {TIMELINE.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: i % 2 === 0 ? -50 : 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className={`relative mb-20 md:w-1/2 ${i % 2 === 0 ? 'md:pr-16 md:text-right md:ml-auto md:translate-x-[-100%]' : 'md:pl-16 md:mr-auto'}`}
              >
                {/* Dot */}
                <div className={`absolute top-0 w-4 h-4 bg-emerald-400 rounded-full border-4 border-emerald-950 z-10 ${i % 2 === 0 ? '-left-[9px] md:left-auto md:-right-[9px]' : '-left-[9px]'}`} />
                
                <div className="bg-emerald-900/40 backdrop-blur p-8 rounded-3xl border border-emerald-800/50 hover:border-emerald-400 transition-colors">
                  <span className="text-emerald-400 font-mono text-3xl font-bold block mb-2">{item.year}</span>
                  <p className="text-emerald-50/80 leading-relaxed">{item.event}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Team/Philosophy Callout */}
      <section className="py-24 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <h2 className="text-3xl font-bold text-slate-800">精益求精的研发态度</h2>
              <p className="text-slate-500 leading-relaxed">
                在田原，研发不仅仅是开发新品，更是对生活品质的深度探索。我们的研发团队由资深厨师和食品工程师跨界组成，从风味还原、口感优化到营养配比，每一步都经过上百次推敲实验。
              </p>
              <div className="space-y-4">
                {[
                  '100% 物理加工工艺，绝不添加违禁化学助剂',
                  '-45℃ 瞬时极速冷冻技术，完美锁鲜',
                  '洁净度达 10 万级的全自动化无尘车间'
                ].map((text, idx) => (
                  <div key={idx} className="flex items-center space-x-3">
                    <div className="w-2 h-2 bg-emerald-600 rounded-full" />
                    <span className="font-semibold text-slate-700">{text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative group">
              <div className="absolute -inset-4 bg-emerald-50 rounded-3xl group-hover:-inset-6 transition-all duration-500" />
              <img 
                src="https://images.unsplash.com/photo-1574672280600-4accfa5b6f98?q=80&w=1000&auto=format&fit=crop" 
                alt="Research Team" 
                className="relative rounded-2xl w-full aspect-[3/2] object-cover shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
