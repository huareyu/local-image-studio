// A small, independently curated starting vocabulary, not NovelAI's official tag database.
const groups = {
    'Персонажи': `1boy|Один мужчина или парень
2boys|Два мужчины или парня
1girl|Одна женщина или девушка
2girls|Две женщины или девушки
solo|Один персонаж в кадре
male focus|Акцент на мужском персонаже
female focus|Акцент на женском персонаже
adult|Взрослый персонаж
multiple boys|Несколько мужчин
multiple girls|Несколько женщин
cat|Кошка или кот
dog|Собака
animal ears|Звериные уши
pointy ears|Заострённые эльфийские уши`,
    'Волосы': `long hair|Длинные волосы
short hair|Короткие волосы
medium hair|Волосы средней длины
very long hair|Очень длинные волосы
shoulder-length hair|Волосы до плеч
brown hair|Каштановые коричневые волосы
black hair|Чёрные волосы
blonde hair|Светлые белокурые волосы блонд
white hair|Белые волосы
grey hair|Серые седые волосы
red hair|Рыжие красные волосы
blue hair|Синие голубые волосы
green hair|Зелёные волосы
pink hair|Розовые волосы
purple hair|Фиолетовые волосы
multicolored hair|Разноцветные волосы
gradient hair|Градиентный цвет волос
wavy hair|Волнистые волосы
curly hair|Кудрявые волосы
straight hair|Прямые волосы
messy hair|Растрёпанные волосы
braid|Коса заплетённые волосы
single braid|Одна коса
twin braids|Две косы
ponytail|Хвост причёска
low ponytail|Низкий хвост
hair bun|Пучок волос
bangs|Чёлка
parted bangs|Разделённая чёлка
hair between eyes|Прядь между глазами
hair over one eye|Волосы закрывают один глаз`,
    'Лицо и глаза': `green eyes|Зелёные глаза
brown eyes|Карие глаза
blue eyes|Синие голубые глаза
grey eyes|Серые глаза
red eyes|Красные глаза
purple eyes|Фиолетовые глаза
yellow eyes|Жёлтые золотистые глаза
heterochromia|Гетерохромия разные цвета глаз
closed eyes|Закрытые глаза
half-closed eyes|Полуприкрытые глаза
long eyelashes|Длинные ресницы
freckles|Веснушки
mole|Родинка
mole under eye|Родинка под глазом
pale skin|Бледная светлая кожа
dark skin|Тёмная кожа
scar|Шрам
facial hair|Растительность на лице
glasses|Очки`,
    'Эмоции': `smile|Улыбка
grin|Широкая улыбка оскал
smirk|Усмешка
laughing|Смех
blush|Румянец смущение
crying|Плач слёзы
angry|Злость сердитое выражение
sad|Грусть печаль
surprised|Удивление
serious|Серьёзное выражение
expressionless|Безэмоциональное лицо
embarrassed|Смущение
tired|Усталость
worried|Тревога беспокойство`,
    'Одежда': `shirt|Рубашка
white shirt|Белая рубашка
black shirt|Чёрная рубашка
t-shirt|Футболка
polo shirt|Поло рубашка
sweater|Свитер
hoodie|Толстовка худи
jacket|Куртка жакет
coat|Пальто
long coat|Длинное пальто
robe|Мантия халат
cloak|Плащ накидка
armor|Доспехи броня
plate armor|Латные доспехи
school uniform|Школьная форма
necktie|Галстук
scarf|Шарф
gloves|Перчатки
pants|Брюки штаны
jeans|Джинсы
shorts|Шорты
skirt|Юбка
dress|Платье
boots|Сапоги ботинки
sneakers|Кроссовки
jewelry|Украшения
earrings|Серьги
necklace|Ожерелье`,
    'Поза и действие': `standing|Стоит
sitting|Сидит
lying|Лежит
walking|Идёт пешком
running|Бежит
looking at viewer|Смотрит на зрителя в камеру
looking away|Смотрит в сторону
looking back|Оглядывается
looking up|Смотрит вверх
looking down|Смотрит вниз
crossed arms|Скрещённые руки
arms behind back|Руки за спиной
hand on hip|Рука на бедре
holding|Держит предмет
holding animal|Держит животное
reading|Читает
reaching out|Протягивает руку
hug|Объятие
dynamic pose|Динамичная поза`,
    'Композиция': `portrait|Портрет
close-up|Крупный план
upper body|Верхняя часть тела
cowboy shot|План до середины бедра
full body|Персонаж в полный рост
wide shot|Общий план
profile|Вид сбоку профиль
from side|Ракурс сбоку
from behind|Вид со спины
from above|Ракурс сверху
from below|Ракурс снизу
dutch angle|Наклонённый горизонт
depth of field|Глубина резкости
blurry background|Размытый фон
foreshortening|Перспективное сокращение
centered composition|Центральная композиция`,
    'Свет и цвет': `soft lighting|Мягкое освещение
backlighting|Контровой свет
rim lighting|Световой ободок по краям
dramatic lighting|Драматичный свет
cinematic lighting|Кинематографичный свет
sunlight|Солнечный свет
moonlight|Лунный свет
candlelight|Свет свечей
neon lights|Неоновый свет
golden hour|Золотой час тёплый закатный свет
warm colors|Тёплые цвета
cool colors|Холодные цвета
muted colors|Приглушённые цвета
pastel colors|Пастельные цвета
monochrome|Монохром чёрно-белое
high contrast|Высокий контраст
volumetric lighting|Объёмный свет лучи`,
    'Окружение': `indoors|В помещении
outdoors|На улице снаружи
forest|Лес
garden|Сад
flower field|Цветочное поле
beach|Пляж
mountain|Гора
city|Город
street|Улица
alley|Переулок
bedroom|Спальня
classroom|Учебный класс
library|Библиотека
castle|Замок
ruins|Руины развалины
night|Ночь
sunset|Закат
rain|Дождь
snow|Снег
autumn|Осень
simple background|Простой фон
white background|Белый фон`,
    'Стиль и качество': `masterpiece|Тег качества шедевр
best quality|Высокое качество
very aesthetic|Эстетичность
highres|Высокая детализация изображения
absurdres|Очень высокая детализация
anime|Аниме
realistic|Реалистичный стиль
semi-realistic|Полуреалистичный стиль
watercolor|Акварель
oil painting|Масляная живопись
sketch|Скетч набросок
lineart|Линейный рисунок
pixel art|Пиксельная графика
chibi|Чиби маленькие пропорции
plush toy|Мягкая игрушка плюшевый персонаж`,
    'Негатив': `low quality|Низкое качество — обычно в негатив
worst quality|Худшее качество — обычно в негатив
blurry|Размытость — по задаче
jpeg artifacts|Артефакты сжатия — обычно в негатив
watermark|Водяной знак — обычно в негатив
signature|Подпись автора — обычно в негатив
text|Надписи и буквы — по задаче
bad anatomy|Ошибки анатомии — обычно в негатив
bad hands|Плохо нарисованные руки — обычно в негатив
extra fingers|Лишние пальцы — обычно в негатив
extra limbs|Лишние конечности — обычно в негатив
missing fingers|Недостающие пальцы — обычно в негатив
multiple views|Несколько видов персонажа — по задаче`,
};

export const BUILTIN_TAGS = Object.entries(groups).flatMap(([category, source]) => source.split('\n').map(line => {
    const [tag, desc] = line.split('|');
    return { tag, desc, category, aliases: [], count: 0 };
}));
