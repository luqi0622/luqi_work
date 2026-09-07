/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HERO_IMAGES } from '../constants';

export default function Carousel() {
  const [current, setCurrent] = useState(0);

  const next = () => setCurrent((current + 1) % HERO_IMAGES.length);
  const prev = () => setCurrent((current - 1 + HERO_IMAGES.length) % HERO_IMAGES.length);

  useEffect(() => {
    const timer = setInterval(next, 5000);
    return () => clearInterval(timer);
  }, [current]);

  const slides = [
    {
      title: '溯源自然 守护味蕾',
      subtitle: '严选生态牧场原料，还原食材最初的本真。',
      image: HERO_IMAGES[0],
    },
    {
      title: '智造美味 匠心品质',
      subtitle: '国际领先加工工艺，每一道工序都精益求精。',
      image: HERO_IMAGES[1],
    },
    {
      title: '生活之选 调理专家',
      subtitle: '让快速简单的烹饪，也能拥有五星级的口感。',
      image: HERO_IMAGES[2],
    },
  ];

  return (
    <div className="relative h-[60vh] md:h-[80vh] w-full overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className="absolute inset-0"
        >
          <div 
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${slides[current].image})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
          </div>
          
          <div className="relative h-full flex flex-col items-center justify-center text-center text-white px-4">
            <motion.h2
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className="text-4xl md:text-6xl font-bold mb-4 tracking-tight"
            >
              {slides[current].title}
            </motion.h2>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
              className="text-lg md:text-xl font-light opacity-90 max-w-2xl"
            >
              {slides[current].subtitle}
            </motion.p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Controls */}
      <button 
        onClick={prev}
        className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full border border-white/30 text-white hover:bg-white/10 transition-colors hidden md:block"
      >
        <ChevronLeft size={24} />
      </button>
      <button 
        onClick={next}
        className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full border border-white/30 text-white hover:bg-white/10 transition-colors hidden md:block"
      >
        <ChevronRight size={24} />
      </button>

      {/* Indicators */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex space-x-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`w-12 h-1.5 rounded-full transition-all duration-500 ${
              current === i ? 'bg-white' : 'bg-white/40'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
