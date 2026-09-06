// ==============================
// Мок-дані каталогу. Пізніше замінюються на реальні запити до backend
// (той самий сервер, що вже роздає /api/register тощо, отримає ще й
// /api/products) — тут просто заглушка, щоб було на чому показати
// макет (категорії зліва, товари по центру, кошик справа) і сторінку
// товару (product.html).
// ==============================

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  emoji: string;
  weight: string;
  description: string;
  shelfLife: string;
  manufacturer: string;
}

export interface Category {
  id: string;
  name: string;
}

export const CATEGORIES: Category[] = [
  { id: "all", name: "Усі товари" },
  { id: "bread", name: "Хліб" },
  { id: "pastry", name: "Випічка" },
  { id: "cakes", name: "Торти" },
  { id: "drinks", name: "Напої" },
];

export const PRODUCTS: Product[] = [
  {
    id: "p1",
    name: "Хліб пшеничний",
    price: 35,
    category: "bread",
    emoji: "🍞",
    weight: "500 г",
    description: "Класичний білий хліб на заквасці, випікається щоранку — хрустка скоринка й м'який м'якуш.",
    shelfLife: "3 доби, у сухому місці при +18…+22°C",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p2",
    name: "Хліб житній",
    price: 38,
    category: "bread",
    emoji: "🍞",
    weight: "500 г",
    description: "Насичений житній хліб з легкою кислинкою — чудово тримає форму для бутербродів.",
    shelfLife: "4 доби, у сухому місці при +18…+22°C",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p3",
    name: "Багет французький",
    price: 42,
    category: "bread",
    emoji: "🥖",
    weight: "250 г",
    description: "Хрумка скоринка й повітряний м'якуш — випікаємо кілька разів на день, щоб завжди був теплий.",
    shelfLife: "1 доба, у паперовому пакеті",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p4",
    name: "Круасан вершковий",
    price: 45,
    category: "pastry",
    emoji: "🥐",
    weight: "80 г",
    description: "Багатошаровий круасан на вершковому маслі — злегка хрусткий зовні, ніжний всередині.",
    shelfLife: "2 доби, у сухому місці",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p5",
    name: "Булочка з корицею",
    price: 40,
    category: "pastry",
    emoji: "🥯",
    weight: "90 г",
    description: "М'яка здобна булочка з корицею й легкою цукровою глазур'ю зверху.",
    shelfLife: "2 доби, у сухому місці",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p6",
    name: "Пиріжок з вишнею",
    price: 32,
    category: "pastry",
    emoji: "🥟",
    weight: "100 г",
    description: "Смажений пиріжок з начинкою з вишні — класика, яку любили ще наші бабусі.",
    shelfLife: "1 доба, у сухому місці",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p7",
    name: "Торт Наполеон",
    price: 320,
    category: "cakes",
    emoji: "🍰",
    weight: "800 г",
    description: "Багатошаровий торт з хрустким тістом і ніжним заварним кремом — готуємо за класичним рецептом.",
    shelfLife: "3 доби, в холодильнику при +2…+6°C",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p8",
    name: "Чізкейк",
    price: 280,
    category: "cakes",
    emoji: "🍮",
    weight: "700 г",
    description: "Ніжний запечений чізкейк на пісочній основі — з легкою карамельною ноткою зверху.",
    shelfLife: "4 доби, в холодильнику при +2…+6°C",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p9",
    name: "Медовик",
    price: 260,
    category: "cakes",
    emoji: "🎂",
    weight: "750 г",
    description: "Медові коржі просочені сметанним кремом — тане в роті, як і має бути в справжньому медовику.",
    shelfLife: "3 доби, в холодильнику при +2…+6°C",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p10",
    name: "Кава американо",
    price: 55,
    category: "drinks",
    emoji: "☕",
    weight: "300 мл",
    description: "Класичний американо зі свіжообсмажених зерен — готуємо на замовлення, кожна чашка свіжа.",
    shelfLife: "Готується на місці, вживати одразу",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p11",
    name: "Капучино",
    price: 65,
    category: "drinks",
    emoji: "☕",
    weight: "300 мл",
    description: "Еспресо з ніжною молочною пінкою — збалансований смак без зайвої гіркоти.",
    shelfLife: "Готується на місці, вживати одразу",
    manufacturer: "Є-Хатинка, Україна",
  },
  {
    id: "p12",
    name: "Морс ягідний",
    price: 45,
    category: "drinks",
    emoji: "🧃",
    weight: "400 мл",
    description: "Домашній морс із суміші лісових ягід — без консервантів і зайвого цукру.",
    shelfLife: "2 доби, в холодильнику при +2…+6°C",
    manufacturer: "Є-Хатинка, Україна",
  },
];
