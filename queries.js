// Product Offer Query V2 with all available fields
export const PRODUCT_OFFER_QUERY = `query Fetch($page: Int, $keyword: String) {
  productOfferV2(
    listType: 0,
    sortType: 2,
    page: $page,
    limit: 50,
    keyword: $keyword
  ) {
    nodes {
      productName
      itemId
      commissionRate
      commission
      price
      sales
      imageUrl
      shopName
      productLink
      offerLink
      periodStartTime
      periodEndTime
      priceMin
      priceMax
      productCatIds
      ratingStar
      priceDiscountRate
      shopId
      shopType
      sellerCommissionRate
      shopeeCommissionRate
    }
    pageInfo {
      page
      limit
      hasNextPage
      scrollId
    }
  }
}`;
