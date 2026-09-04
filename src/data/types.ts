export type ListingStatus = 'active' | 'draft' | 'ended' | 'unknown' | 'out_of_stock'
export interface Store {
  id: string
  nickname: string
  ebayUsername: string
  connected: boolean
  active: boolean
}
export interface Listing {
  id: string
  ebayId: string
  title: string
  asin: string
  amazonPrice: number
  ebayPrice: number
  quantity: number
  status: ListingStatus
  image: string
  storeId: string
  listedDate: string
  soldCount: number
  promoted: boolean
  checkedDate?: string | null
}
export interface Order {
  id: string
  storeId: string
  orderId: string
  buyerName: string
  buyerUsername: string
  listingTitle: string
  listingImage: string
  asin: string
  ebayPrice: number
  amazonCost: number
  profit: number
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled'
  orderDate: string
  shipToName: string
  shipToStreet: string
  shipToCity: string
  shipToState: string
  shipToZip: string
  shipToCountry: string
  trackingNumber: string | null
  trackingCarrier: string | null
  notes: string
}
export interface Conversation {
  id: string
  buyerName: string
  buyerUsername: string
  listingTitle: string
  lastMessage: string
  lastMessageDate: string
  unread: boolean
  messages: Message[]
}
export interface Message {
  id: string
  from: 'buyer' | 'seller'
  body: string
  date: string
}
export interface Revision {
  id: string
  listingTitle: string
  field: 'price' | 'quantity' | 'status'
  oldValue: string
  newValue: string
  reason: string
  date: string
}
export interface BulkRun {
  id: string
  name: string
  type: 'one-time' | 'scheduled' | 'drip'
  status: 'running' | 'completed' | 'failed' | 'paused'
  total: number
  succeeded: number
  failed: number
  date: string
  items: BulkRunItem[]
}
export interface BulkRunItem {
  id: string
  asin: string
  title: string
  status: 'success' | 'failed' | 'pending'
  error?: string
}
export interface Draft {
  id: string
  asin: string
  title: string
  amazonPrice: number
  image: string
  savedDate: string
  bulkRunId?: string
}
export interface Invoice {
  id: string
  date: string
  amount: number
  plan: string
  status: 'paid' | 'open' | 'void'
}
export interface TeamMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'va'
  joinedDate: string
}
export interface AmazonAccount {
  id: string
  email: string
  region: string
  status: 'connected' | 'disconnected'
}
