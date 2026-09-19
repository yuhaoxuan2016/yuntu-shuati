// 首页「每日一诗」数据源（公共领域古典诗词，均为前代名家作品，无版权问题）
// 主题筛选：专注「劝学 / 惜时 / 坚韧 / 进取 / 悟理」，呼应「激励做题与学习」
// 用法：import { poemOfTheDay, todayLabel } from '../lib/poems'
export interface Poem {
  title: string
  author: string
  dynasty: string
  content: string // 以 \n 分行
}

export const poems: Poem[] = [
  { title: '劝学', author: '颜真卿', dynasty: '唐', content: '三更灯火五更鸡，正是男儿读书时。\n黑发不知勤学早，白首方悔读书迟。' },
  { title: '偶成', author: '朱熹', dynasty: '宋', content: '少年易老学难成，一寸光阴不可轻。\n未觉池塘春草梦，阶前梧叶已秋声。' },
  { title: '冬夜读书示子聿', author: '陆游', dynasty: '宋', content: '古人学问无遗力，少壮工夫老始成。\n纸上得来终觉浅，绝知此事要躬行。' },
  { title: '观书有感', author: '朱熹', dynasty: '宋', content: '半亩方塘一鉴开，天光云影共徘徊。\n问渠那得清如许？为有源头活水来。' },
  { title: '杂诗', author: '陶渊明', dynasty: '晋', content: '盛年不重来，一日难再晨。\n及时当勉励，岁月不待人。' },
  { title: '长歌行', author: '汉乐府', dynasty: '汉', content: '百川东到海，何时复西归？\n少壮不努力，老大徒伤悲。' },
  { title: '金缕衣', author: '杜秋娘', dynasty: '唐', content: '劝君莫惜金缕衣，劝君惜取少年时。\n花开堪折直须折，莫待无花空折枝。' },
  { title: '书院', author: '刘过', dynasty: '宋', content: '力学如力耕，勤惰尔自知。\n但使书种多，会有岁稔时。' },
  { title: '登鹳雀楼', author: '王之涣', dynasty: '唐', content: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。' },
  { title: '题西林壁', author: '苏轼', dynasty: '宋', content: '横看成岭侧成峰，远近高低各不同。\n不识庐山真面目，只缘身在此山中。' },
  { title: '赋得古原草送别', author: '白居易', dynasty: '唐', content: '离离原上草，一岁一枯荣。\n野火烧不尽，春风吹又生。' },
  { title: '竹石', author: '郑燮', dynasty: '清', content: '咬定青山不放松，立根原在破岩中。\n千磨万击还坚劲，任尔东西南北风。' },
  { title: '石灰吟', author: '于谦', dynasty: '明', content: '千锤万凿出深山，烈火焚烧若等闲。\n粉骨碎身浑不怕，要留清白在人间。' },
  { title: '乐游原', author: '李商隐', dynasty: '唐', content: '向晚意不适，驱车登古原。\n夕阳无限好，只是近黄昏。' },
  { title: '悯农', author: '李绅', dynasty: '唐', content: '锄禾日当午，汗滴禾下土。\n谁知盘中餐，粒粒皆辛苦。' },
  { title: '春日', author: '朱熹', dynasty: '宋', content: '胜日寻芳泗水滨，无边光景一时新。\n等闲识得东风面，万紫千红总是春。' },
]

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

// 今日中文日期标签：2026年8月10日 星期一
export function todayLabel(): string {
  const d = new Date()
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`
}

// 每日一诗：按本地日期确定性取一首（当天稳定，次日换一首，轮转遍历）
export function poemOfTheDay(): Poem {
  const d = new Date()
  const dayIdx = Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000,
  )
  return poems[((dayIdx % poems.length) + poems.length) % poems.length]
}
