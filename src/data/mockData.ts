import type {
  Store, Listing, Order, Conversation, Revision,
  BulkRun, Draft, Invoice, TeamMember, AmazonAccount, Message,
} from './types'

export const stores: Store[] = [
  { id: 's1', nickname: 'Main Store', ebayUsername: 'tubika_main', connected: true, active: true },
  { id: 's2', nickname: 'Tech Hub', ebayUsername: 'techhub_2024', connected: true, active: false },
  { id: 's3', nickname: 'Home Goods', ebayUsername: 'homegoods_plus', connected: false, active: false },
]

const productImages = [
  'https://images.pexels.com/photos/437037/pexels-photo-437037.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/356056/pexels-photo-356056.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/90946/pexels-photo-90946.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/1056251/pexels-photo-1056251.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/1432673/pexels-photo-1432673.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/1432674/pexels-photo-1432674.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/264636/pexels-photo-264636.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/339465/pexels-photo-339465.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/1666071/pexels-photo-1666071.jpeg?auto=compress&cs=tinysrgb&w=200',
  'https://images.pexels.com/photos/1851164/pexels-photo-1851164.jpeg?auto=compress&cs=tinysrgb&w=200',
]

const titles = [
  'Wireless Bluetooth Earbuds Pro Max - Active Noise Cancelling',
  'Stainless Steel Water Bottle 32oz - Vacuum Insulated',
  'LED Desk Lamp with USB Charging Port - Dimmable Touch Control',
  'Premium Yoga Mat Non-Slip 1/4 Inch Extra Thick TPE',
  'Portable External Battery 26800mAh Power Bank Fast Charging',
  'Smart Watch Fitness Tracker Heart Rate Monitor IP68 Waterproof',
  'Mechanical Gaming Keyboard RGB Backlit 87 Keys Hot Swappable',
  'USB-C Hub Multiport Adapter 8-in-1 4K HDMI Ethernet SD',
  'Adjustable Laptop Stand Aluminum Ergonomic Cooling Ventilated',
  'Noise Cancelling Headphones Over-Ear 40H Playtime Deep Bass',
  'Electric Toothbrush Sonic 5 Modes Smart Timer 30-Day Battery',
  'Mini Projector 1080P Portable Outdoor Movie Projector HDMI',
  'Robot Vacuum Cleaner 2000Pa Suction Smart App Control',
  'Air Purifier HEPA Filter for Home Allergies Pets Smoke',
  'Bluetooth Speaker Waterproof IPX7 24H Playtime 360° Sound',
  'Phone Charger Cable 10ft Nylon Braided USB-C Fast Charge 3Pack',
  'Kitchen Scale Digital 11lb/5kg Precise Tare Function LCD',
  'Backpack Laptop Travel Anti-Theft Water Resistant 20L',
  'Ring Light 18 inch LED with Stand Phone Holder Dimmable',
  'Drone with Camera 4K HD Live Video GPS FPV Quadcopter Adults',
]

const asins = [
  'B0D1Z8K3L5', 'B0C9X2M7N4', 'B0B7Y3P9Q1', 'B0D3F5R6T8', 'B0C5H8J2K6',
  'B0A9L4M3N7', 'B0D2P5Q8R3', 'B0C1X6Z9W4', 'B0B4F7H2J5', 'B0D8K3L6M9',
]

function randomPrice(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

export const listings: Listing[] = Array.from({ length: 48 }, (_, i) => {
  const statusPool: Listing['status'][] = ['active', 'active', 'active', 'active', 'draft', 'ended', 'out_of_stock', 'unknown']
  const status = i < 3 ? 'unknown' : statusPool[Math.floor(Math.random() * statusPool.length)]
  const amazonPrice = randomPrice(8, 120)
  const ebayPrice = Math.round((amazonPrice * (1 + Math.random() * 0.35 + 0.15)) * 100) / 100
  return {
    id: `l${i + 1}`,
    ebayId: `EB${100000 + i}`,
    title: titles[i % titles.length],
    asin: asins[i % asins.length],
    amazonPrice,
    ebayPrice,
    quantity: Math.floor(Math.random() * 50) + 1,
    status,
    image: productImages[i % productImages.length],
    storeId: stores[i % stores.length].id,
    listedDate: new Date(Date.now() - Math.random() * 90 * 86400000).toISOString(),
    soldCount: Math.floor(Math.random() * 120),
    promoted: Math.random() > 0.4,
  }
})

const buyerNames = [
  'John Smith', 'Emily Davis', 'Michael Brown', 'Sarah Wilson', 'David Lee',
  'Jessica Martinez', 'Robert Taylor', 'Ashley Anderson', 'James Thomas', 'Amanda White',
  'Christopher Moore', 'Stephanie Jackson', 'Matthew Harris', 'Nicole Thompson',
]

const cities = [
  ['Brooklyn', 'NY', '11201'], ['Austin', 'TX', '73301'], ['Seattle', 'WA', '98101'],
  ['Miami', 'FL', '33101'], ['Denver', 'CO', '80201'], ['Portland', 'OR', '97201'],
  ['Chicago', 'IL', '60601'], ['Atlanta', 'GA', '30301'], ['Phoenix', 'AZ', '85001'],
]

const carriers = ['USPS', 'UPS', 'FedEx', 'Amazon Logistics']

export const orders: Order[] = Array.from({ length: 32 }, (_, i) => {
  const listing = listings[i % listings.length]
  const amazonCost = listing.amazonPrice
  const ebayPrice = listing.ebayPrice
  const profit = Math.round((ebayPrice - amazonCost - ebayPrice * 0.13) * 100) / 100
  const statusPool: Order['status'][] = ['pending', 'shipped', 'delivered', 'delivered', 'shipped', 'cancelled']
  const status = statusPool[Math.floor(Math.random() * statusPool.length)]
  const cityIdx = i % cities.length
  const hasTracking = status === 'shipped' || status === 'delivered'
  return {
    id: `o${i + 1}`,
    storeId: listing.storeId,
    orderId: `ORD-${200000 + i}`,
    buyerName: buyerNames[i % buyerNames.length],
    buyerUsername: buyerNames[i % buyerNames.length].toLowerCase().replace(' ', '_'),
    listingTitle: listing.title,
    listingImage: listing.image,
    asin: listing.asin,
    ebayPrice,
    amazonCost,
    profit,
    status,
    orderDate: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
    shipToName: buyerNames[i % buyerNames.length],
    shipToStreet: `${100 + i} Main Street`,
    shipToCity: cities[cityIdx][0],
    shipToState: cities[cityIdx][1],
    shipToZip: cities[cityIdx][2],
    shipToCountry: 'US',
    trackingNumber: hasTracking ? `TRK${3000000 + i}US` : null,
    trackingCarrier: hasTracking ? carriers[i % carriers.length] : null,
    notes: '',
  }
})

export const conversations: Conversation[] = Array.from({ length: 12 }, (_, i) => {
  const buyerName = buyerNames[i % buyerNames.length]
  const listing = listings[i % listings.length]
  const msgs: Message[] = [
    {
      id: `m${i}-1`,
      from: 'buyer',
      body: `Hi, is the ${listing.title.substring(0, 30)}... still available?`,
      date: new Date(Date.now() - (5 - i % 5) * 3600000 - 7200000).toISOString(),
    },
    {
      id: `m${i}-2`,
      from: 'seller',
      body: 'Yes it is! I have plenty in stock. It ships within 1 business day.',
      date: new Date(Date.now() - (5 - i % 5) * 3600000 - 3600000).toISOString(),
    },
    {
      id: `m${i}-3`,
      from: 'buyer',
      body: 'Great, does it come with a warranty?',
      date: new Date(Date.now() - (5 - i % 5) * 3600000).toISOString(),
    },
  ]
  return {
    id: `c${i + 1}`,
    buyerName,
    buyerUsername: buyerName.toLowerCase().replace(' ', '_'),
    listingTitle: listing.title,
    lastMessage: msgs[msgs.length - 1].body,
    lastMessageDate: msgs[msgs.length - 1].date,
    unread: i < 4,
    messages: msgs,
  }
})

export const revisions: Revision[] = Array.from({ length: 18 }, (_, i) => {
  const listing = listings[i % listings.length]
  const fields: Revision['field'][] = ['price', 'quantity', 'status']
  const field = fields[i % 3]
  const oldVal = field === 'price' ? `$${randomPrice(15, 80)}` : field === 'quantity' ? `${Math.floor(Math.random() * 40) + 5}` : 'Active'
  const newVal = field === 'price' ? `$${randomPrice(15, 80)}` : field === 'quantity' ? `${Math.floor(Math.random() * 40) + 1}` : 'Out of Stock'
  return {
    id: `r${i + 1}`,
    listingTitle: listing.title,
    field,
    oldValue: oldVal,
    newValue: newVal,
    reason: field === 'price' ? 'Amazon source price changed' : field === 'quantity' ? 'Amazon stock updated' : 'Amazon out of stock',
    date: new Date(Date.now() - Math.random() * 24 * 3600000).toISOString(),
  }
})

export const bulkRuns: BulkRun[] = [
  {
    id: 'b1',
    name: 'Electronics Batch — Aug',
    type: 'one-time',
    status: 'completed',
    total: 20, succeeded: 17, failed: 3,
    date: new Date(Date.now() - 2 * 86400000).toISOString(),
    items: Array.from({ length: 20 }, (_, j) => ({
      id: `b1-${j}`,
      asin: asins[j % asins.length],
      title: titles[j % titles.length],
      status: j < 17 ? 'success' as const : 'failed' as const,
      error: j >= 17 ? j === 17 ? 'ASIN not found' : j === 18 ? 'eBay listing error: category mismatch' : 'Rate limited by Amazon' : undefined,
    })),
  },
  {
    id: 'b2',
    name: 'Home Goods — Scheduled Daily',
    type: 'scheduled',
    status: 'running',
    total: 15, succeeded: 8, failed: 1,
    date: new Date(Date.now() - 3 * 3600000).toISOString(),
    items: Array.from({ length: 15 }, (_, j) => ({
      id: `b2-${j}`,
      asin: asins[j % asins.length],
      title: titles[(j + 5) % titles.length],
      status: j < 8 ? 'success' as const : j === 8 ? 'failed' as const : 'pending' as const,
      error: j === 8 ? 'Duplicate listing' : undefined,
    })),
  },
  {
    id: 'b3',
    name: 'Tech Accessories Drip',
    type: 'drip',
    status: 'paused',
    total: 10, succeeded: 4, failed: 0,
    date: new Date(Date.now() - 5 * 86400000).toISOString(),
    items: Array.from({ length: 10 }, (_, j) => ({
      id: `b3-${j}`,
      asin: asins[j % asins.length],
      title: titles[(j + 10) % titles.length],
      status: j < 4 ? 'success' as const : 'pending' as const,
    })),
  },
]

export const singleDrafts: Draft[] = Array.from({ length: 6 }, (_, i) => ({
  id: `sd${i + 1}`,
  asin: asins[i % asins.length],
  title: titles[i % titles.length],
  amazonPrice: randomPrice(10, 90),
  image: productImages[i % productImages.length],
  savedDate: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
}))

export const bulkDrafts: Draft[] = Array.from({ length: 12 }, (_, i) => ({
  id: `bd${i + 1}`,
  asin: asins[(i + 2) % asins.length],
  title: titles[(i + 3) % titles.length],
  amazonPrice: randomPrice(12, 85),
  image: productImages[(i + 2) % productImages.length],
  savedDate: new Date(Date.now() - Math.random() * 14 * 86400000).toISOString(),
  bulkRunId: `b${(i % 3) + 1}`,
}))

export const invoices: Invoice[] = Array.from({ length: 6 }, (_, i) => ({
  id: `inv${i + 1}`,
  date: new Date(Date.now() - i * 30 * 86400000).toISOString(),
  amount: [49.00, 49.00, 49.00, 29.00, 29.00, 29.00][i],
  plan: i < 3 ? 'Pro' : 'Starter',
  status: i === 0 ? 'open' : 'paid',
}))

export const teamMembers: TeamMember[] = [
  { id: 'tm1', name: 'You (Owner)', email: 'owner@tubika.com', role: 'owner', joinedDate: new Date(Date.now() - 120 * 86400000).toISOString() },
  { id: 'tm2', name: 'Sarah VA', email: 'sarah.va@gmail.com', role: 'va', joinedDate: new Date(Date.now() - 45 * 86400000).toISOString() },
  { id: 'tm3', name: 'Mike Lister', email: 'mike.lister@gmail.com', role: 'va', joinedDate: new Date(Date.now() - 12 * 86400000).toISOString() },
]

export const amazonAccounts: AmazonAccount[] = [
  { id: 'a1', email: 'buyer1@amazon.com', region: 'US', status: 'connected' },
  { id: 'a2', email: 'buyer2@amazon.com', region: 'US', status: 'disconnected' },
]

export const plans = [
  { name: 'Starter', price: 29, features: ['1 eBay store', '500 listings', 'Single & Bulk Lister', 'Auto repricing', 'Email support'] },
  { name: 'Pro', price: 49, features: ['3 eBay stores', 'Unlimited listings', 'AI title generation (50 credits)', 'Auto Order', 'Priority support', 'Team members (3)'] },
  { name: 'Business', price: 99, features: ['10 eBay stores', 'Unlimited listings', 'AI title generation (200 credits)', 'Auto Order + Auto Fulfill', 'Priority support', 'Unlimited team members'] },
]
