---
title: 光子计算仿真的自动化实践
description: 用 Lumerical API + Python 把重复的参数扫描工作流串起来：从手动点菜单到一条命令跑通宵。
pubDate: 2026-08-20
tags: ['学术随笔', '技术思考']
featured: true
---

做硅基光电子器件的人大概都有类似体验：一个结构要扫 5 个参数，每个参数 20 个取值，组合下来上万次仿真。手动跑不现实，于是自动化成了刚需。

## 从「点菜单」到「写脚本」

Lumerical 提供了完整的脚本 API，但很多人仍停留在 GUI 里点菜单。转折点发生在我第三次重复同一批设置之后——**凡是做过两遍的事情，就该写成脚本**。

```python
import lumapi

fdtd = lumapi.FDTD()
fdtd.load("base_device.fsp")

# 参数扫描：波导宽度 × 耦合间隙
for w in np.arange(0.4, 0.6, 0.02):
    for g in np.arange(0.1, 0.3, 0.01):
        fdtd.select("waveguide")
        fdtd.set("width", w)
        fdtd.select("gap_region")
        fdtd.set("x span", g)
        fdtd.run()
        result = fdtd.getresult("monitor", "transmission")
        save_result(w, g, result)
```

一段二十行的脚本，把一周的工作压缩到一夜。

## 结果管理的价值

跑得快只是第一步。上万组参数的产出，如果没有结构化的存储（我们用 HDF5 + 一个索引 CSV），后期分析照样是灾难。

$$
T(w, g) = \left| \frac{E_{\mathrm{out}}(w, g)}{E_{\mathrm{in}}} \right|^2
$$

把透射率 $T$ 拟合成参数的响应面之后，寻优就不再需要在仿真器里暴力搜索了。

> [!TIP]
> 仿真日志里把每次运行的参数完整写进结果文件，半年后的你会感谢这个习惯。

## 下一步

正在把这个流程封装成一个小工具，扫描任务排队、断点续跑、结果自动可视化。做好之后会放进「项目」页。
