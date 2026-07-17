package com.krushna.flashflow.inventory;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface InventoryRepository extends JpaRepository<Inventory, UUID> {

    @Modifying
    @Query("UPDATE Inventory i SET i.availableStock = i.availableStock - :quantity, i.totalStock = i.totalStock - :quantity WHERE i.productId = :productId AND i.availableStock >= :quantity")
    int decrementStock(@Param("productId") UUID productId, @Param("quantity") int quantity);

    @Modifying
    @Query("UPDATE Inventory i SET i.availableStock = i.availableStock + :quantity, i.totalStock = i.totalStock + :quantity WHERE i.productId = :productId")
    int incrementStock(@Param("productId") UUID productId, @Param("quantity") int quantity);
}
